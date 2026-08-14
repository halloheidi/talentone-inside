// Controlling-Kernlogik (Phase 7). Rein-funktional so weit möglich —
// die Datenzugriffe sind dünn und leicht ersetzbar für Tests.
//
// Wichtige Regeln aus dem Phase-7-Go:
//   MRR = nur Abos in Phase 'active' ODER 'guarantee'. Werbebudget zählt
//     NIE. Bei Start/Ende im Monat: anteilig.
//   Annahmequote: Zähler und Nenner enthalten AUCH accepted-Angebote,
//     die nie 'sent' waren (direkt-accepted). Sonst > 100 % möglich.
//   Offene Forderungen: Werbebudget mitzählen — offen ist offen.
//   Garantiekosten: waived_service_amount aus billing_skip_log.
//   Churn: beendete Abos im Zeitraum ÷ aktive Abos zu Periodenbeginn.
//
// Alle Aggregationen liefern brand-getrennte Werte.

import { supabase } from './supabase.js';

/** Wiederholung von computeBillingPhase() aus offer-list — hier für die
 *  Server-seitige Aggregation dupliziert (kein Cross-Import auf routes/*). */
export function billingPhaseOf(offer, hireCount = 0, today = new Date()) {
  if (offer.billing_external_at) return 'extern';
  if (offer.billing_ended_at)   return 'ended';
  if (offer.billing_paused_at)  return 'paused';
  if (!offer.campaign_started_at) return 'inactive';
  if (hireCount > 0)            return 'active';
  const start = new Date(offer.campaign_started_at);
  const cutoff = new Date(start.getTime() + (Number(offer.guarantee_period_days) || 30) * 86400000);
  return today <= cutoff ? 'guarantee' : 'guarantee_expired';
}

/**
 * Berechnet den anteiligen MRR-Beitrag EINES Angebots für einen konkreten
 * Kalendermonat. Ergebnis in Euro (netto), immer inkl. Phasen-Filter.
 * Werbebudget-Anteile werden nie eingerechnet.
 *
 * @param {object} offer
 * @param {number} hireCount
 * @param {Date}   monthStart  1. des Monats
 * @param {Date}   monthEnd    letzter Kalendertag des Monats (inklusive)
 * @returns {{ amount:number, phase:string, days_active:number, days_in_month:number }}
 */
export function computeOfferMrrShareForMonth(offer, hireCount, monthStart, monthEnd) {
  const daysInMonth = Math.round((monthEnd - monthStart) / 86400000) + 1;
  const monthlyTotal = Number(offer.monthly_total) || 0;
  if (monthlyTotal <= 0) return { amount: 0, phase: 'inactive', days_active: 0, days_in_month: daysInMonth };

  // Anker: tool-seitige Aktivierung, sonst (rein extern abgerechnet) das
  // Extern-Datum — so zählt ein extern abgerechnetes Angebot weiter im MRR.
  const externalAt = offer.billing_external_at ? new Date(offer.billing_external_at) : null;
  const start = offer.campaign_started_at ? new Date(offer.campaign_started_at) : externalAt;
  const endTs = offer.billing_ended_at ? new Date(offer.billing_ended_at) : null;
  if (!start || start > monthEnd) return { amount: 0, phase: 'inactive', days_active: 0, days_in_month: daysInMonth };

  // Aktiver Zeitraum im Monat
  const activeFrom = start > monthStart ? start : monthStart;
  const activeTo   = endTs && endTs < monthEnd ? endTs : monthEnd;
  if (activeTo < activeFrom) return { amount: 0, phase: 'ended', days_active: 0, days_in_month: daysInMonth };

  const dayStartUTC = d => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

  // Extern abgerechnet: zählt anteilig als laufender Umsatz, ohne Garantie-/
  // Pausen-Gating (die Rechnung entsteht extern, der Umsatz bleibt).
  if (externalAt && externalAt <= monthEnd) {
    const daysActiveX = Math.floor((dayStartUTC(activeTo) - dayStartUTC(activeFrom)) / 86400000) + 1;
    const amountX = Math.round(monthlyTotal * (daysActiveX / daysInMonth) * 100) / 100;
    return { amount: amountX, phase: 'extern', days_active: daysActiveX, days_in_month: daysInMonth };
  }

  // Phase-Bestimmung für MRR: billing_ended_at wird durch die
  // anteilige Berechnung abgebildet, NICHT als Phasen-Ausschluss.
  // billing_paused_at wird nur ausgeschlossen, wenn die Pause schon
  // vor der aktiven Sub-Periode begonnen hat.
  // Konservativ: sobald das Abo IM Monat pausiert wurde (oder vorher),
  // zählt der Monat komplett als paused. Kein Anteils-Split für die
  // wenigen Tage vor der Pause — das ist die Business-Erwartung.
  const pausedAt = offer.billing_paused_at ? new Date(offer.billing_paused_at) : null;
  if (pausedAt && pausedAt <= monthEnd) {
    return { amount: 0, phase: 'paused', days_active: 0, days_in_month: daysInMonth };
  }
  // Referenztag: Mitte der aktiven Sub-Periode
  const referenceDay = new Date(activeFrom.getTime() + Math.floor((activeTo - activeFrom) / 2));
  let phase;
  if (hireCount > 0) phase = 'active';
  else {
    const cutoff = new Date(new Date(offer.campaign_started_at).getTime() + (Number(offer.guarantee_period_days) || 30) * 86400000);
    phase = referenceDay <= cutoff ? 'guarantee' : 'guarantee_expired';
  }

  if (phase !== 'active' && phase !== 'guarantee') {
    return { amount: 0, phase, days_active: 0, days_in_month: daysInMonth };
  }

  // Tages-basiert zählen (Uhrzeit-Anteile beim Ende-Datum werden nach unten
  // abgeschnitten — Tag der Kündigung zählt als aktiver Tag).
  const dayStart = d => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const daysActive = Math.floor((dayStart(activeTo) - dayStart(activeFrom)) / 86400000) + 1;
  const share = daysActive / daysInMonth;
  const amount = Math.round(monthlyTotal * share * 100) / 100;
  return { amount, phase, days_active: daysActive, days_in_month: daysInMonth };
}

/**
 * MRR über eine Liste Angebote für einen Monat (i.d.R. aktueller Monat).
 * @returns {{ total:number, in_guarantee:number, by_brand:{talentone,nowag_wirth} }}
 */
export function computeMrr(offersWithHireCount, monthStart, monthEnd) {
  let total = 0, inGuarantee = 0;
  const byBrand = { talentone: 0, nowag_wirth: 0 };
  for (const { offer, hire_count } of offersWithHireCount) {
    const r = computeOfferMrrShareForMonth(offer, hire_count, monthStart, monthEnd);
    if (r.amount <= 0) continue;
    total += r.amount;
    byBrand[offer.brand] = (byBrand[offer.brand] || 0) + r.amount;
    if (r.phase === 'guarantee') inGuarantee += r.amount;
  }
  const round = v => Math.round(v * 100) / 100;
  return {
    total: round(total),
    in_guarantee: round(inGuarantee),
    by_brand: { talentone: round(byBrand.talentone), nowag_wirth: round(byBrand.nowag_wirth) },
  };
}

/**
 * Annahmequote = angenommen / (versendet + direkt-angenommen).
 * accepted OHNE sent kommen in ZÄHLER UND NENNER — sonst > 100 %.
 *
 * @param {Array} offers Liste (id, status, sent_at, accepted_at)
 * @param {{from:Date, to:Date}} range
 */
export function computeAcceptanceRate(offers, { from, to }) {
  let sent = 0, accepted = 0;
  for (const o of offers) {
    const sentAt = o.sent_at ? new Date(o.sent_at) : null;
    const acceptedAt = o.accepted_at ? new Date(o.accepted_at) : null;
    const inRangeSent     = sentAt && sentAt >= from && sentAt <= to;
    const inRangeAccepted = acceptedAt && acceptedAt >= from && acceptedAt <= to;
    if (inRangeSent)     sent++;
    if (inRangeAccepted) accepted++;
    // Direkt-accepted (nie sent) im Zeitraum → auch in den Nenner
    if (inRangeAccepted && !sentAt) sent++;
  }
  const rate = sent > 0 ? Math.round((accepted / sent) * 1000) / 10 : 0;
  return { sent, accepted, rate };
}

/** Funnel je Marke im Zeitraum: erstellt/versendet/angenommen. */
export function computeFunnel(offers, { from, to }) {
  const acc = { talentone: { created: 0, sent: 0, accepted: 0 },
                nowag_wirth: { created: 0, sent: 0, accepted: 0 } };
  for (const o of offers) {
    const b = acc[o.brand]; if (!b) continue;
    if (o.created_at && new Date(o.created_at) >= from && new Date(o.created_at) <= to) b.created++;
    if (o.sent_at    && new Date(o.sent_at)    >= from && new Date(o.sent_at)    <= to) b.sent++;
    if (o.accepted_at && new Date(o.accepted_at) >= from && new Date(o.accepted_at) <= to) b.accepted++;
  }
  return acc;
}

/** Churn = beendete Abos im Zeitraum ÷ aktive zu Periodenbeginn. */
export function computeChurn(offers, { from, to }) {
  let activeAtStart = 0, endedInRange = 0;
  for (const o of offers) {
    const started = o.campaign_started_at ? new Date(o.campaign_started_at) : null;
    const ended   = o.billing_ended_at ? new Date(o.billing_ended_at) : null;
    if (started && started < from && (!ended || ended >= from)) activeAtStart++;
    if (ended && ended >= from && ended <= to) endedInRange++;
  }
  const rate = activeAtStart > 0 ? Math.round((endedInRange / activeAtStart) * 1000) / 10 : 0;
  return { active_at_start: activeAtStart, ended_in_range: endedInRange, rate };
}

/**
 * Ø Zeit sent→accepted (in Tagen). Nur Angebote mit beiden Zeitstempeln
 * im Zeitraum zählen (Zeitpunkt = accepted_at).
 */
export function computeAvgTurnaround(offers, { from, to }) {
  const days = [];
  for (const o of offers) {
    if (!o.sent_at || !o.accepted_at) continue;
    const acc = new Date(o.accepted_at);
    if (acc < from || acc > to) continue;
    days.push((acc - new Date(o.sent_at)) / 86400000);
  }
  if (!days.length) return { count: 0, avg_days: null };
  return { count: days.length,
           avg_days: Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 };
}

// ────── Aggregations mit DB-Zugriff ──────

/** Bulk-Fetch Hire-Counts für eine Angebotsliste. */
export async function loadHireCounts(offerIds) {
  const map = new Map(offerIds.map(id => [id, 0]));
  if (!offerIds.length) return map;
  const { data } = await supabase.from('talentone_hires').select('offer_id').in('offer_id', offerIds);
  for (const h of (data || [])) map.set(h.offer_id, (map.get(h.offer_id) || 0) + 1);
  return map;
}

/** Angebote laden — für die meisten Auswertungen. */
export async function loadOffers({ brand } = {}) {
  let q = supabase.from('talentone_offers')
    .select('id, brand, status, created_at, sent_at, accepted_at, campaign_started_at, billing_ended_at, billing_paused_at, guarantee_period_days, hires_target, monthly_total, first_month_total, ad_budget_monthly, customer_snapshot, easybill_document_id');
  if (brand) q = q.eq('brand', brand);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

export async function loadInvoices({ brand, statuses = null } = {}) {
  let q = supabase.from('talentone_invoices').select('*');
  if (brand) q = q.eq('brand', brand);
  if (statuses) q = q.in('status', statuses);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

export async function loadSkipLog({ brand, from = null, to = null } = {}) {
  let q = supabase.from('talentone_billing_skip_log').select('*');
  if (brand) q = q.eq('brand', brand);
  if (from) q = q.gte('period_start', from);
  if (to)   q = q.lte('period_start', to);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}
