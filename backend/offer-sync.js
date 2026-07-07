// Rücksync-Logik für Angebote (Phase 4).
//
// Ziel: Wenn ein Angebot (OFFER) in easybill in eine Auftragsbestätigung
// (CHARGE_CONFIRM) — oder direkt in eine Rechnung (INVOICE) — umgewandelt
// wird, springt der Status im Tool auf 'accepted' und wir merken uns die
// Nachfolge-Doc-ID.
//
// Variante B (verpflichtend, hier implementiert): Cron alle 15 Minuten.
//   Für jedes talentone_offer mit status IN ('created','sent') und
//   easybill_document_id != null:
//     GET /documents?ref_id=<easybill_document_id>&type=CHARGE_CONFIRM,INVOICE
//     → wenn Nachfolge-Doc existiert: applyAcceptedTransition().
// Idempotent: wenn easybill_order_document_id bereits gesetzt und identisch,
// werden nur last_synced_at aktualisiert.
//
// Variante A (Webhook) ergänzt das im Handler routes/webhooks.js — der
// Webhook ruft dieselbe applyAcceptedTransition() auf, sodass beide Wege
// idempotent und logikgleich sind.

import { supabase } from './supabase.js';
import { listDocumentsByRefId } from './easybill.js';
import { addNote as closeAddNote } from './close.js';

const EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const BRAND_LABEL = { talentone: 'TalentOne', nowag_wirth: 'Nowag & Wirth' };

const OPEN_STATUSES     = ['created', 'sent'];  // die kandidieren fürs Polling
const ACCEPTED_TRIGGERS = ['CHARGE_CONFIRM', 'INVOICE']; // Nachfolge-Docs

let syncRunning = false;
let lastRunAt   = null;
let lastResult  = null;

/**
 * Rein-funktionaler Kern: berechnet den DB-Patch für einen 'accepted'-Übergang.
 * Keine IO — testbar ohne Supabase-Mock.
 *
 * @param {object} offer — Row aus talentone_offers
 * @param {object} successor — easybill-Document (CHARGE_CONFIRM | INVOICE)
 * @param {string} now — ISO-Timestamp (Injection für stabile Tests)
 * @returns {{ patch:object|null, changed:boolean, noop:'already_in_sync'|null }}
 */
export function computeTransitionPatch(offer, successor, now) {
  if (!offer || !successor) return { patch: null, changed: false, noop: null };

  const successorId     = String(successor.id);
  const isChargeConfirm = successor.type === 'CHARGE_CONFIRM';

  // Idempotenz: schon 'accepted' und AB-ID stimmt → nur last_synced_at auffrischen
  if (offer.status === 'accepted'
      && offer.easybill_order_document_id === successorId) {
    return {
      patch: { last_synced_at: now },
      changed: false,
      noop: 'already_in_sync',
    };
  }

  // Ein Angebot kann direkt in eine Rechnung umgewandelt worden sein (kein AB-
  // Zwischenschritt). Dann setzen wir status='accepted' + last_synced_at, aber
  // easybill_order_document_id bleibt null (steht später für die AB bereit).
  const patch = {
    status: 'accepted',
    accepted_at: offer.accepted_at || now,
    last_synced_at: now,
  };
  if (isChargeConfirm) patch.easybill_order_document_id = successorId;

  return { patch, changed: true, noop: null };
}

/**
 * Rein-funktionaler Kern: wählt aus mehreren Nachfolgern denjenigen, der für
 * den 'accepted'-Übergang zählt (CHARGE_CONFIRM > INVOICE).
 */
export function pickSuccessor(successors) {
  if (!Array.isArray(successors) || !successors.length) return null;
  return successors.find(d => d?.type === 'CHARGE_CONFIRM') || successors[0] || null;
}

/**
 * Applied den 'accepted'-Übergang idempotent auf ein Angebot (IO-Wrapper).
 */
export async function applyAcceptedTransition(offer, successor) {
  const now = new Date().toISOString();
  const { patch, changed } = computeTransitionPatch(offer, successor, now);
  if (!patch) return { changed: false, offer };

  const query = supabase.from('talentone_offers').update(patch).eq('id', offer.id);
  if (changed) {
    const { data, error } = await query.select().single();
    if (error) throw new Error(`Supabase update: ${error.message}`);
    console.log(`[offer-sync] Angebot ${offer.id} → accepted (via ${successor.type} ${successor.id})`);

    // Best-effort Close-Notiz — nie den Sync-Flow blockieren.
    if (offer.close_lead_id) {
      const brandLabel = BRAND_LABEL[offer.brand] || offer.brand;
      const monat1     = EUR.format(Number(offer.first_month_total) || 0);
      const abNumber   = successor.number ? `AB ${successor.number}` : `Doc ${successor.id}`;
      const note = `✅ Angebot angenommen: ${brandLabel} — ${abNumber} — Monat 1: ${monat1}`;
      closeAddNote({ leadId: offer.close_lead_id, note })
        .catch(err => console.warn(`[offer-sync close-note]`, err.message));
    }
    return { changed: true, offer: data };
  } else {
    // Kein select() nötig — wir wollen nur last_synced_at fortschreiben
    const { error } = await query;
    if (error) throw new Error(`Supabase update: ${error.message}`);
    return { changed: false, offer: { ...offer, ...patch } };
  }
}

/**
 * Prüft ein einzelnes Angebot gegen easybill und triggered bei Fund einen
 * Übergang. Nutzt CHARGE_CONFIRM > INVOICE Prio: wenn beides existiert
 * (unwahrscheinlich, aber möglich), zählt die AB.
 * @param {object} offer — Row aus talentone_offers
 */
export async function syncOne(offer) {
  if (!offer?.easybill_document_id) return { skipped: true, reason: 'no easybill_document_id' };
  const successors = await listDocumentsByRefId({
    refId: offer.easybill_document_id,
    types: ACCEPTED_TRIGGERS,
    limit: 20,
  });
  if (!successors.length) {
    // Nur last_synced_at fortschreiben — als "hab hingeschaut, nichts Neues".
    await supabase.from('talentone_offers')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('id', offer.id);
    return { changed: false, checked: true };
  }
  const chosen = pickSuccessor(successors);
  return applyAcceptedTransition(offer, chosen);
}

/**
 * Bulk-Sync aller offenen Angebote (Cron-Job).
 */
export async function syncOpenOffers() {
  if (syncRunning) return { skipped: true, reason: 'Sync läuft bereits.' };
  syncRunning = true;
  const t0 = Date.now();
  let checked = 0, changed = 0, errors = [];
  try {
    const { data: offers, error } = await supabase
      .from('talentone_offers')
      .select('id, status, easybill_document_id, easybill_order_document_id, accepted_at')
      .in('status', OPEN_STATUSES)
      .not('easybill_document_id', 'is', null);
    if (error) throw new Error(`Supabase list: ${error.message}`);

    for (const o of offers || []) {
      checked++;
      try {
        const r = await syncOne(o);
        if (r?.changed) changed++;
      } catch (err) {
        errors.push({ offer_id: o.id, error: err.message });
        console.warn(`[offer-sync] Fehler bei ${o.id}: ${err.message}`);
      }
    }
    lastResult = { checked, changed, errors, duration_ms: Date.now() - t0 };
    lastRunAt = new Date().toISOString();
    console.log(`[offer-sync] Runde fertig — ${checked} geprüft, ${changed} → accepted (${lastResult.duration_ms} ms)`);
    return lastResult;
  } finally {
    syncRunning = false;
  }
}

export function getOfferSyncStatus() {
  return { running: syncRunning, last_run_at: lastRunAt, last_result: lastResult };
}

/**
 * Cron: initial +45s, danach alle 15 Minuten. Fehler werden geloggt, blockieren
 * den restlichen Server nicht. Der easybill-Kunden-Sync läuft in einem
 * eigenen Timer parallel — beide sind unabhängig.
 */
export function startOfferSyncScheduler() {
  const INTERVAL_MS      = 15 * 60 * 1000;
  const INITIAL_DELAY_MS = 45 * 1000;
  if (!process.env.EASYBILL_API_KEY) {
    console.warn('[offer-sync] EASYBILL_API_KEY nicht gesetzt — Scheduler nicht gestartet.');
    return;
  }
  setTimeout(() => {
    syncOpenOffers().catch(err => console.error('[offer-sync] initial:', err.message));
    setInterval(() => {
      syncOpenOffers().catch(err => console.error('[offer-sync] cron:', err.message));
    }, INTERVAL_MS);
  }, INITIAL_DELAY_MS);
  console.log('[offer-sync] Scheduler aktiv (initial +45s, danach alle 15 Min).');
}
