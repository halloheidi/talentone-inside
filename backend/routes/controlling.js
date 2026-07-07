// Controlling-Dashboard-API (Phase 7). Admin-Only.
//
// Alle Endpoints erwarten optional ?from=YYYY-MM-DD, ?to=YYYY-MM-DD, ?brand=…
// (talentone | nowag_wirth). Zeitraum-Default: laufender Monat.

import { Router } from 'express';
import { supabase } from '../supabase.js';
import { requireAdmin } from '../auth.js';
import {
  computeMrr, computeAcceptanceRate, computeFunnel, computeChurn,
  computeAvgTurnaround, loadHireCounts, loadOffers, loadInvoices, loadSkipLog,
  billingPhaseOf,
} from '../controlling-service.js';

const router = Router();

// Alle Endpoints sind Admin-only.
router.use(requireAdmin);

function parseRange(q) {
  const now = new Date();
  const from = q.from ? new Date(q.from + 'T00:00:00Z')
                      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to   = q.to   ? new Date(q.to   + 'T23:59:59Z')
                      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59));
  return { from, to };
}
function monthBounds(year, monthIdx) {
  const start = new Date(Date.UTC(year, monthIdx, 1));
  const end   = new Date(Date.UTC(year, monthIdx + 1, 0));
  return { start, end };
}
function last12Months(refDate = new Date()) {
  const out = [];
  const y = refDate.getUTCFullYear(), m = refDate.getUTCMonth();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - i, 1));
    out.push({ year: d.getUTCFullYear(), monthIdx: d.getUTCMonth(),
               key: d.toISOString().slice(0, 7),
               label: d.toLocaleDateString('de-DE', { month: 'short', year: '2-digit', timeZone: 'UTC' }) });
  }
  return out;
}

/* GET /api/controlling/kpis?from=&to=&brand= */
router.get('/kpis', async (req, res) => {
  try {
    const brand = req.query.brand || null;
    const { from, to } = parseRange(req.query || {});
    const offers = await loadOffers({ brand });
    const acceptedOfferIds = offers.filter(o => o.campaign_started_at).map(o => o.id);
    const hireCounts = await loadHireCounts(acceptedOfferIds);
    const offersWithHc = offers.map(o => ({ offer: o, hire_count: hireCounts.get(o.id) || 0 }));

    // MRR — laufender Kalendermonat
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
    const mrrNow  = computeMrr(offersWithHc, monthStart, monthEnd);
    const prevStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const prevEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    const mrrPrev = computeMrr(offersWithHc, prevStart, prevEnd);
    const mrrDelta = Math.round((mrrNow.total - mrrPrev.total) * 100) / 100;

    const funnel     = computeFunnel(offers, { from, to });
    const acceptance = computeAcceptanceRate(offers, { from, to });

    // Ø Monat-1-Wert angenommener Angebote im Zeitraum, je Marke
    const acceptedInRange = offers.filter(o => o.accepted_at && new Date(o.accepted_at) >= from && new Date(o.accepted_at) <= to);
    const avgMonth1 = { talentone: null, nowag_wirth: null };
    for (const b of ['talentone', 'nowag_wirth']) {
      const list = acceptedInRange.filter(o => o.brand === b);
      if (list.length) {
        const sum = list.reduce((s, o) => s + (Number(o.first_month_total) || 0), 0);
        avgMonth1[b] = Math.round((sum / list.length) * 100) / 100;
      }
    }

    // Offene Forderungen (Werbebudget zählt hier mit — offen ist offen)
    const openInvoices = await loadInvoices({ brand, statuses: ['sent', 'partially_paid', 'overdue'] });
    const nowDate = new Date();
    let open_total = 0, overdue_total = 0;
    for (const i of openInvoices) {
      const gross = Number(i.amount_gross) || 0;
      open_total += gross;
      if (i.due_date && new Date(i.due_date) < nowDate) overdue_total += gross;
    }
    open_total = Math.round(open_total * 100) / 100;
    overdue_total = Math.round(overdue_total * 100) / 100;

    // Garantiekosten (aus Skip-Log) je Marke
    const skips = await loadSkipLog({ brand, from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) });
    const guarantee_costs = { talentone: 0, nowag_wirth: 0 };
    for (const s of skips) {
      guarantee_costs[s.brand] = (guarantee_costs[s.brand] || 0) + Number(s.waived_service_amount || 0);
    }
    guarantee_costs.talentone   = Math.round(guarantee_costs.talentone * 100) / 100;
    guarantee_costs.nowag_wirth = Math.round(guarantee_costs.nowag_wirth * 100) / 100;

    // Churn im Zeitraum
    const churn = computeChurn(offers, { from, to });
    const turnaround = computeAvgTurnaround(offers, { from, to });

    res.json({
      range: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      brand,
      mrr: {
        total: mrrNow.total,
        by_brand: mrrNow.by_brand,
        in_guarantee: mrrNow.in_guarantee,
        prev_total: mrrPrev.total,
        delta: mrrDelta,
      },
      funnel,
      acceptance,
      avg_month1: avgMonth1,
      open_receivables: { total: open_total, overdue: overdue_total, count: openInvoices.length },
      guarantee_costs,
      churn,
      turnaround,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* GET /api/controlling/mrr-trend?brand= — letzte 12 Monate, gestapelt nach Marke */
router.get('/mrr-trend', async (req, res) => {
  try {
    // Datenbasis: reale monthly_service-Anteile aus talentone_invoices
    // (invoice_type IN ('monthly_service','monthly_combined')). Bei
    // monthly_combined ist der Werbebudget-Anteil enthalten und muss abgezogen
    // werden — Konvention: monthly_combined-amount_net = Service + adBudget.
    // Wir nutzen offer.monthly_total als "Soll für Service" und subtrahieren
    // (amount_net - monthly_total) → das ist der Budget-Teil.
    const months = last12Months();
    const brand = req.query.brand || null;

    let invQ = supabase.from('talentone_invoices')
      .select('id, brand, invoice_type, period_start, amount_net, offer_id, status')
      .in('invoice_type', ['monthly_service', 'monthly_combined'])
      .neq('status', 'cancelled')
      .gte('period_start', months[0].key + '-01');
    if (brand) invQ = invQ.eq('brand', brand);
    const { data: invoices } = await invQ;

    // monthly_total je offer für die Service-Anteils-Aufteilung bei combined
    const offerIds = [...new Set((invoices || []).map(i => i.offer_id).filter(Boolean))];
    let offerMap = new Map();
    if (offerIds.length) {
      const { data: offs } = await supabase.from('talentone_offers')
        .select('id, monthly_total').in('id', offerIds);
      offerMap = new Map((offs || []).map(o => [o.id, Number(o.monthly_total) || 0]));
    }

    const trend = months.map(m => ({ key: m.key, label: m.label, talentone: 0, nowag_wirth: 0 }));
    for (const inv of (invoices || [])) {
      if (!inv.period_start) continue;
      const key = inv.period_start.slice(0, 7);
      const row = trend.find(t => t.key === key);
      if (!row) continue;
      let serviceShare;
      if (inv.invoice_type === 'monthly_combined') {
        const svc = offerMap.get(inv.offer_id) || 0;
        serviceShare = Math.min(Number(inv.amount_net) || 0, svc);
      } else {
        serviceShare = Number(inv.amount_net) || 0;
      }
      row[inv.brand] = Math.round((row[inv.brand] + serviceShare) * 100) / 100;
    }
    res.json({ trend });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* GET /api/controlling/revenue-monthly?brand= — Setup vs monatliche Pauschalen
   je Monat + Werbebudget als separate Linie (Durchleitung, nicht Umsatz). */
router.get('/revenue-monthly', async (req, res) => {
  try {
    const months = last12Months();
    const brand = req.query.brand || null;
    let q = supabase.from('talentone_invoices')
      .select('brand, invoice_type, period_start, amount_net, offer_id, status, created_at')
      .neq('status', 'cancelled')
      .gte('created_at', months[0].key + '-01T00:00:00Z');
    if (brand) q = q.eq('brand', brand);
    const { data: invoices } = await q;

    const offerIds = [...new Set((invoices || []).map(i => i.offer_id).filter(Boolean))];
    const offerMap = new Map();
    if (offerIds.length) {
      const { data: offs } = await supabase.from('talentone_offers')
        .select('id, monthly_total').in('id', offerIds);
      for (const o of (offs || [])) offerMap.set(o.id, Number(o.monthly_total) || 0);
    }

    const monthly = months.map(m => ({ key: m.key, label: m.label, setup: 0, service: 0, ad_budget: 0 }));
    for (const inv of (invoices || [])) {
      const anchor = inv.period_start ? inv.period_start.slice(0, 7)
                    : (inv.created_at || '').slice(0, 7);
      const row = monthly.find(t => t.key === anchor);
      if (!row) continue;
      const net = Number(inv.amount_net) || 0;
      if (inv.invoice_type === 'setup')            row.setup += net;
      else if (inv.invoice_type === 'monthly_service') row.service += net;
      else if (inv.invoice_type === 'ad_budget')       row.ad_budget += net;
      else if (inv.invoice_type === 'monthly_combined') {
        const svc = Math.min(net, offerMap.get(inv.offer_id) || 0);
        row.service   += svc;
        row.ad_budget += Math.max(0, net - svc);
      }
    }
    for (const r of monthly) {
      r.setup = Math.round(r.setup * 100) / 100;
      r.service = Math.round(r.service * 100) / 100;
      r.ad_budget = Math.round(r.ad_budget * 100) / 100;
    }
    res.json({ monthly });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* GET /api/controlling/hire-times?brand= — Ø Zeit bis 1. + bis Ziel-Einstellung,
   je guarantee_period_days */
router.get('/hire-times', async (req, res) => {
  try {
    const brand = req.query.brand || null;
    let offersQ = supabase.from('talentone_offers')
      .select('id, brand, campaign_started_at, guarantee_period_days, hires_target')
      .not('campaign_started_at', 'is', null);
    if (brand) offersQ = offersQ.eq('brand', brand);
    const { data: offers } = await offersQ;
    const ids = (offers || []).map(o => o.id);
    if (!ids.length) return res.json({ groups: [] });
    const { data: hires } = await supabase.from('talentone_hires')
      .select('offer_id, hired_at').in('offer_id', ids)
      .order('hired_at', { ascending: true });

    const byOffer = new Map();
    for (const h of (hires || [])) {
      const arr = byOffer.get(h.offer_id) || [];
      arr.push(h.hired_at);
      byOffer.set(h.offer_id, arr);
    }
    const groups = {};
    for (const o of offers) {
      const gk = `${o.brand}_${o.guarantee_period_days || 30}`;
      const first = byOffer.get(o.id)?.[0];
      const arr = byOffer.get(o.id) || [];
      const target = Math.max(1, Number(o.hires_target) || 1);
      const goalHit = arr.length >= target ? arr[target - 1] : null;
      const startTs = new Date(o.campaign_started_at).getTime();
      groups[gk] = groups[gk] || { brand: o.brand, guarantee_period_days: o.guarantee_period_days || 30,
                                    first_days: [], goal_days: [] };
      if (first)   groups[gk].first_days.push((new Date(first).getTime() - startTs) / 86400000);
      if (goalHit) groups[gk].goal_days.push((new Date(goalHit).getTime() - startTs) / 86400000);
    }
    const out = Object.values(groups).map(g => ({
      brand: g.brand,
      guarantee_period_days: g.guarantee_period_days,
      avg_days_to_first: g.first_days.length ? Math.round(g.first_days.reduce((a, b) => a + b, 0) / g.first_days.length * 10) / 10 : null,
      avg_days_to_goal:  g.goal_days.length  ? Math.round(g.goal_days.reduce((a, b) => a + b, 0)  / g.goal_days.length  * 10) / 10 : null,
      offers_with_hire: g.first_days.length,
      offers_with_goal: g.goal_days.length,
    }));
    res.json({ groups: out });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* GET /api/controlling/open-invoices?brand= — sortiert nach Überfälligkeit */
router.get('/open-invoices', async (req, res) => {
  try {
    const brand = req.query.brand || null;
    let q = supabase.from('talentone_invoices')
      .select('*').in('status', ['sent', 'partially_paid', 'overdue']);
    if (brand) q = q.eq('brand', brand);
    const { data } = await q;
    const now = Date.now();
    const enriched = (data || []).map(i => ({
      ...i,
      overdue_days: i.due_date ? Math.floor((now - new Date(i.due_date).getTime()) / 86400000) : null,
    })).sort((a, b) => (b.overdue_days || -1e9) - (a.overdue_days || -1e9));
    res.json({ invoices: enriched });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* GET /api/controlling/abos-in-guarantee?brand= — Frühwarnliste. */
router.get('/abos-in-guarantee', async (req, res) => {
  try {
    const brand = req.query.brand || null;
    const offers = await loadOffers({ brand });
    const acceptedIds = offers.filter(o => o.campaign_started_at).map(o => o.id);
    const hireCounts = await loadHireCounts(acceptedIds);
    const today = new Date();
    const out = [];
    for (const o of offers) {
      if (!o.campaign_started_at || o.billing_ended_at || o.billing_paused_at) continue;
      const hc = hireCounts.get(o.id) || 0;
      const phase = billingPhaseOf(o, hc, today);
      if (phase !== 'guarantee') continue;
      const cutoff = new Date(new Date(o.campaign_started_at).getTime() + (Number(o.guarantee_period_days) || 30) * 86400000);
      const days_remaining = Math.ceil((cutoff - today) / 86400000);
      out.push({
        id: o.id, brand: o.brand,
        firma: o.customer_snapshot?.company_name || null,
        campaign_started_at: o.campaign_started_at,
        guarantee_period_days: o.guarantee_period_days,
        hires_target: o.hires_target,
        monthly_total: o.monthly_total,
        days_remaining,
      });
    }
    out.sort((a, b) => a.days_remaining - b.days_remaining);
    res.json({ abos: out });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* GET /api/controlling/abos-servicefree-paused?brand= — servicefreie + pausierte. */
router.get('/abos-servicefree-paused', async (req, res) => {
  try {
    const brand = req.query.brand || null;
    const offers = await loadOffers({ brand });
    const acceptedIds = offers.filter(o => o.campaign_started_at).map(o => o.id);
    const hireCounts = await loadHireCounts(acceptedIds);
    const today = new Date();
    const out = [];
    for (const o of offers) {
      if (!o.campaign_started_at || o.billing_ended_at) continue;
      const hc = hireCounts.get(o.id) || 0;
      const phase = billingPhaseOf(o, hc, today);
      if (phase !== 'guarantee_expired' && phase !== 'paused') continue;
      out.push({
        id: o.id, brand: o.brand,
        firma: o.customer_snapshot?.company_name || null,
        phase,
        campaign_started_at: o.campaign_started_at,
        billing_paused_at: o.billing_paused_at,
        monthly_total: o.monthly_total,
      });
    }
    res.json({ abos: out });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* GET /api/controlling/latest-offers?limit=20&brand= */
router.get('/latest-offers', async (req, res) => {
  try {
    const brand = req.query.brand || null;
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    let q = supabase.from('talentone_offers')
      .select('id, brand, status, first_month_total, monthly_total, created_at, customer_snapshot, easybill_document_id')
      .order('created_at', { ascending: false }).limit(limit);
    if (brand) q = q.eq('brand', brand);
    const { data } = await q;
    res.json({ offers: data || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
