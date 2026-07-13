// Rücksync für talentone_invoices (Phase 5) — analog zu offer-sync.js:
// Für jede offene Rechnung prüfen wir in easybill den paid_at/is_paid-Status
// und den amount_paid und mappen den Status entsprechend.
//
// Ergänzt außerdem die Kampagnen-Ampel-Logik (campaign_payment_status
// am Kunden): Budget-Rechnung überfällig → 'pending' bzw. 'blocked'.

import { supabase } from './supabase.js';
import { getDocument } from './easybill.js';

export const OPEN_STATUSES = ['sent', 'partially_paid', 'overdue'];

/**
 * Reine Predicate: qualifiziert eine Row für den Bulk-Sync?
 * Bewusst OHNE Filter auf `source`, `invoice_type` oder `offer_id`
 * — Standalone-Rechnungen und Setup-/Monats-/AB-Rechnungen laufen alle
 * über denselben Sync.
 */
export function isInSyncScope(invoice) {
  return !!invoice
    && OPEN_STATUSES.includes(invoice.status)
    && invoice.easybill_document_id != null;
}

/**
 * Reine Ampel-Berechnung für die Rechnungen EINES Kunden.
 * Berücksichtigt sowohl die durchs Abo entstehenden ad_budget-Rechnungen
 * als auch freistehende Standalone-Rows — Kriterium ist `invoice_type`,
 * nicht `source`.
 *
 * @param {Array} invoices — Rows für EINEN Kunden
 * @param {Date}  now
 * @returns {'ok'|'pending'|'blocked'}
 */
export function evaluateAmpelStatus(invoices = [], now = new Date()) {
  const relevant = invoices.filter(i =>
    i && ['ad_budget', 'monthly_combined'].includes(i.invoice_type)
      && OPEN_STATUSES.includes(i.status)
  );
  let target = 'ok';
  for (const inv of relevant) {
    if (!inv.due_date) continue;
    const overdueDays = Math.floor((now - new Date(inv.due_date)) / 86400000);
    if (overdueDays > 7)      return 'blocked';
    else if (overdueDays > 0) target = 'pending';
  }
  return target;
}

let running = false;
let lastRunAt = null;
let lastResult = null;

/**
 * Rein-funktional: berechnet den neuen Rechnungs-Status aus dem easybill-Doc.
 * Idempotent: wenn schon 'paid' und paid_at identisch → keine Änderung nötig.
 */
export function computeInvoiceStatusPatch(invoice, doc, now = new Date().toISOString()) {
  if (!doc) return { patch: null, changed: false };
  const paidCents  = Number(doc.paid_amount) || Number(doc.amount_paid) || 0;
  const totalCents = Number(doc.amount) || 0;
  const paidAt = doc.paid_at || null;

  let status = invoice.status;
  if (doc.is_paid || (paidCents > 0 && paidCents >= totalCents)) status = 'paid';
  else if (paidCents > 0)                                         status = 'partially_paid';
  else if (doc.is_overdue)                                        status = 'overdue';

  const paidAtIso = paidAt ? new Date(paidAt).toISOString() : null;

  if (status === invoice.status
      && ((paidAtIso == null && invoice.paid_at == null)
          || paidAtIso === invoice.paid_at)) {
    return { patch: { last_synced_at: now }, changed: false, noop: 'already_in_sync' };
  }
  const patch = { status, last_synced_at: now };
  if (paidAtIso) patch.paid_at = paidAtIso;
  return { patch, changed: true };
}

async function syncOne(invoice) {
  if (!invoice.easybill_document_id) {
    await supabase.from('talentone_invoices')
      .update({ last_synced_at: new Date().toISOString() }).eq('id', invoice.id);
    return { checked: true, changed: false };
  }
  let doc;
  try { doc = await getDocument(invoice.easybill_document_id); }
  catch (e) {
    console.warn(`[invoice-sync] getDocument ${invoice.easybill_document_id}: ${e.message}`);
    return { checked: true, changed: false, error: e.message };
  }
  const { patch, changed } = computeInvoiceStatusPatch(invoice, doc);
  if (!patch) return { checked: true, changed: false };
  await supabase.from('talentone_invoices').update(patch).eq('id', invoice.id);

  // Zahlung neu eingegangen? → Close-Note (best-effort)
  if (changed && patch.status === 'paid' && invoice.status !== 'paid') {
    try {
      const { data: full } = await supabase.from('talentone_invoices')
        .select('offer_id, amount_cent').eq('id', invoice.id).maybeSingle();
      let kundeId = null;
      if (full?.offer_id) {
        const { data: offer } = await supabase.from('talentone_offers')
          .select('customer_id').eq('id', full.offer_id).maybeSingle();
        kundeId = offer?.customer_id || null;
      }
      if (kundeId) {
        const { notifyKundeById } = await import('./close.js');
        const betragCent = Number(full?.amount_cent) || Number(doc.amount) || 0;
        const betragEuro = betragCent > 0
          ? (betragCent / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
          : '';
        notifyKundeById(kundeId,
          `✅ Zahlung${betragEuro ? ` über ${betragEuro}` : ''} eingegangen am ${new Date().toLocaleDateString('de-DE')}`,
          supabase,
        ).catch(err => console.warn('[invoice-sync close-note inner]', err.message));
      }
    } catch (err) { console.warn('[invoice-sync close-note]', err.message); }
  }
  return { checked: true, changed };
}

/** Bulk-Sync aller offenen Rechnungen. */
export async function syncOpenInvoices() {
  if (running) return { skipped: true };
  running = true;
  const t0 = Date.now();
  let checked = 0, changed = 0, errors = [];
  try {
    const { data: invoices, error } = await supabase.from('talentone_invoices')
      .select('id, status, easybill_document_id, paid_at')
      .in('status', OPEN_STATUSES)
      .not('easybill_document_id', 'is', null);
    if (error) throw new Error(error.message);
    for (const inv of invoices || []) {
      checked++;
      try {
        const r = await syncOne(inv);
        if (r.changed) changed++;
      } catch (err) {
        errors.push({ invoice_id: inv.id, error: err.message });
      }
    }
    lastResult = { checked, changed, errors, duration_ms: Date.now() - t0 };
    lastRunAt = new Date().toISOString();
    console.log(`[invoice-sync] Runde fertig — ${checked} geprüft, ${changed} aktualisiert`);
    return lastResult;
  } finally { running = false; }
}

export function getInvoiceSyncStatus() {
  return { running, last_run_at: lastRunAt, last_result: lastResult };
}

// ─────────────────────── Kampagnen-Ampel ───────────────────────
/**
 * Berechnet campaign_payment_status pro Kunde:
 *   ok       — keine überfällige Budget-Rechnung
 *   pending  — Budget-Rechnung offen aber ≤ 7 Tage überfällig
 *   blocked  — > 7 Tage überfällig (nur Anzeige — keine Meta-Automatik)
 * Aktualisiert talentone_kunden.campaign_payment_status.
 */
export async function evaluateCampaignPaymentStatus() {
  const now = new Date();
  const { data: kunden } = await supabase
    .from('talentone_kunden').select('id, campaign_payment_status');
  if (!kunden?.length) return { checked: 0, changed: 0 };

  let changed = 0;
  for (const k of kunden) {
    const { data: invs } = await supabase
      .from('talentone_invoices')
      .select('id, due_date, status, invoice_type')
      .eq('customer_id', k.id)
      .in('invoice_type', ['ad_budget', 'monthly_combined'])
      .in('status', OPEN_STATUSES);
    const target = evaluateAmpelStatus(invs || [], now);
    if (target !== k.campaign_payment_status) {
      await supabase.from('talentone_kunden')
        .update({ campaign_payment_status: target }).eq('id', k.id);
      changed++;
    }
  }
  return { checked: kunden.length, changed };
}

/**
 * Scheduler: initial +90s, danach alle 15 min. Ergänzt den offer-sync-Cron,
 * indem er zusätzlich die Rechnungs- und Kampagnen-Status pflegt.
 */
export function startInvoiceSyncScheduler() {
  const INTERVAL_MS = 15 * 60 * 1000;
  const INITIAL_DELAY_MS = 90 * 1000;
  if (!process.env.EASYBILL_API_KEY) {
    console.warn('[invoice-sync] EASYBILL_API_KEY nicht gesetzt — Scheduler nicht gestartet.');
    return;
  }
  setTimeout(() => {
    const run = () => Promise.allSettled([syncOpenInvoices(), evaluateCampaignPaymentStatus()]);
    run().catch(err => console.error('[invoice-sync] initial:', err.message));
    setInterval(() => { run().catch(err => console.error('[invoice-sync] cron:', err.message)); }, INTERVAL_MS);
  }, INITIAL_DELAY_MS);
  console.log('[invoice-sync] Scheduler aktiv (initial +90s, danach alle 15 Min).');
}
