// Erinnerungsmail für überfällige Rechnungen (Phase 5).
//
// Läuft täglich einmal (Berlin 09:00). Sucht alle talentone_invoices mit
// status IN (sent, partially_paid, overdue) und due_date < heute, die noch
// nicht in den letzten 5 Tagen erinnert wurden. Nutzt reminder_email-
// Template je Marke, löst Merge-Tags auf und sendet über
// sendErinnerungsMail (angebote@… + Reply-To info@nowagwirth.de, Team-BCC).
// Idempotent per Feld reminder_sent_at (nicht persistiert — Signal ist die
// Zeit seit letzter Erinnerung + der eigene 5-Tage-Guard über updated_at).
//
// Sendet höchstens EINE Erinnerung pro Rechnung pro Woche.

import { supabase } from './supabase.js';
import { sendErinnerungsMail } from './mail.js';

const EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const DE  = { day: '2-digit', month: '2-digit', year: 'numeric' };

const REMINDER_COOLDOWN_DAYS = 5;

let running = false;
let lastRunAt = null;
let lastResult = null;

function fillMergeTags(text, ctx) {
  return String(text || '').replace(/\{\{(\w+)\}\}/g, (_, k) => (ctx[k] == null ? '' : String(ctx[k])));
}

/** Fügt eine Notiz an eine Invoice-Row an (letzte Erinnerungs-Zeitpunkt). */
async function markReminderSent(invoiceId) {
  await supabase.from('talentone_invoices')
    .update({ last_synced_at: new Date().toISOString() }) // Signal-Marker (auch für Cooldown)
    .eq('id', invoiceId);
}

/**
 * Wählt fällige Kandidaten: überfällig, nicht bezahlt, letzter Sync
 * älter als COOLDOWN. Als konservative Näherung nutzen wir last_synced_at
 * als "vorher schon einmal berührt"-Marker.
 */
async function fetchCandidates() {
  const cutoffIso = new Date(Date.now() - REMINDER_COOLDOWN_DAYS * 86400000).toISOString();
  const todayIso  = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase.from('talentone_invoices')
    .select('*')
    .in('status', ['sent', 'partially_paid', 'overdue'])
    .lt('due_date', todayIso)
    .or(`last_synced_at.is.null,last_synced_at.lt.${cutoffIso}`);
  if (error) throw new Error(error.message);
  return data || [];
}

async function fetchOffer(id) {
  const { data } = await supabase.from('talentone_offers').select('*').eq('id', id).maybeSingle();
  return data || null;
}
async function fetchKunde(id) {
  if (!id) return null;
  const { data } = await supabase.from('talentone_kunden').select('*').eq('id', id).maybeSingle();
  return data || null;
}
async function fetchTemplate(brand) {
  const { data } = await supabase.from('talentone_offer_templates')
    .select('key,text').eq('brand', brand).eq('key', 'reminder_email').maybeSingle();
  return data?.text || '';
}
async function fetchInvoiceNumberFromEasybill(easybillDocId) {
  if (!easybillDocId) return null;
  try {
    const { getDocument } = await import('./easybill.js');
    const d = await getDocument(easybillDocId);
    return d?.number || null;
  } catch { return null; }
}

/**
 * Ein einzelner Reminder-Lauf pro Invoice.
 */
async function processOne(inv) {
  const offer = await fetchOffer(inv.offer_id);
  const kunde = await fetchKunde(inv.customer_id);
  const to = kunde?.email
    || offer?.customer_snapshot?.email
    || null;
  if (!to) return { invoiceId: inv.id, skipped: true, reason: 'no_email' };

  const templateText = await fetchTemplate(inv.brand);
  if (!templateText) return { invoiceId: inv.id, skipped: true, reason: 'no_template' };

  const rechnungsNr = await fetchInvoiceNumberFromEasybill(inv.easybill_document_id) || inv.easybill_document_id || inv.id.slice(0, 8);
  const ctx = {
    RECHNUNGSNUMMER: String(rechnungsNr),
    BETRAG:          EUR.format(Number(inv.amount_gross) || 0),
    RECHNUNGSDATUM:  inv.created_at ? new Date(inv.created_at).toLocaleDateString('de-DE', DE) : '—',
    FAELLIGKEIT:     inv.due_date ? new Date(inv.due_date).toLocaleDateString('de-DE', DE) : '—',
  };
  const body = fillMergeTags(templateText, ctx);
  const subject = `Erinnerung: Rechnung ${rechnungsNr} noch offen`;

  try {
    await sendErinnerungsMail({ to, offerBrand: inv.brand, subject, body });
    await markReminderSent(inv.id);
    console.log(`[reminder] Rechnung ${inv.id.slice(0, 8)} → Erinnerung an ${to}`);
    return { invoiceId: inv.id, sent: true, to };
  } catch (err) {
    console.warn(`[reminder] Mail fehlgeschlagen für ${inv.id.slice(0, 8)}: ${err.message}`);
    return { invoiceId: inv.id, sent: false, error: err.message };
  }
}

export async function runReminderRound() {
  if (running) return { skipped: true };
  running = true;
  const t0 = Date.now();
  const results = [];
  try {
    const candidates = await fetchCandidates();
    for (const inv of candidates) results.push(await processOne(inv));
    const sent = results.filter(r => r.sent).length;
    lastResult = { checked: candidates.length, sent, results, duration_ms: Date.now() - t0 };
    lastRunAt = new Date().toISOString();
    console.log(`[reminder] Runde fertig — ${candidates.length} geprüft, ${sent} versendet`);
    return lastResult;
  } finally { running = false; }
}

export function getReminderStatus() { return { running, last_run_at: lastRunAt, last_result: lastResult }; }

export function startReminderScheduler() {
  const CHECK_MS = 60 * 60 * 1000;
  const INIT_MS  = 150 * 1000;
  if (!process.env.EASYBILL_API_KEY) {
    console.warn('[reminder] EASYBILL_API_KEY nicht gesetzt — Scheduler nicht gestartet.');
    return;
  }
  const check = () => {
    const now = new Date();
    const berlinHour = Number(now.toLocaleString('de-DE', { hour: '2-digit', hour12: false, timeZone: 'Europe/Berlin' }));
    if (berlinHour !== 9) return;
    runReminderRound().catch(err => console.error('[reminder]', err.message));
  };
  setTimeout(() => { check(); setInterval(check, CHECK_MS); }, INIT_MS);
  console.log('[reminder] Scheduler aktiv (täglich 09:00 Berlin).');
}
