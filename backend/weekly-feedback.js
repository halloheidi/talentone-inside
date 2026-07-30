// Wöchentliche Zufriedenheits-Feedback-Mail — freitags 10:00 Berlin.
//
// Regeln:
//  - nur TalentOne-Kunden mit Live-Projekt (Status 'live'), ab Live-Tag ≥5
//  - max. 1 Mail pro Kunde pro Woche (auch bei mehreren Live-Projekten → ein Kunde,
//    ein Formular mit übergreifendem Projekt-Bezug)
//  - nach 2× in Folge unbeantwortet → auf 14-tägig reduziert
//  - abschaltbar pro Kunde (feedback_mails=false)

import { randomUUID } from 'node:crypto';
import { supabase } from './supabase.js';
import { sendFeedbackAnfrage } from './mail.js';
import { getPublicBaseUrl } from './branding.js';

let running = false;
let lastRunAt = null;
let lastResult = null;

const MIN_LIVE_TAG = 5;

function tageSeit(iso) {
  if (!iso) return null;
  const d = new Date(String(iso).length <= 10 ? iso + 'T00:00:00Z' : iso);
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

// Stabiler Wochen-Schlüssel (ISO-Woche), z. B. "2026-KW31".
export function isoWoche(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-KW${String(week).padStart(2, '0')}`;
}

async function fetchCandidates() {
  const { data: projekte } = await supabase.from('talentone_projekte')
    .select('id, kunde_id, start_phase1, live_termin, status')
    .eq('status', 'live');
  if (!projekte?.length) return [];

  // Pro Kunde: das Live-Projekt mit dem frühesten Live-Start (längste Laufzeit),
  // das die Mindest-Laufzeit erreicht hat.
  const byKunde = new Map();
  for (const p of projekte) {
    const start = p.start_phase1 || p.live_termin;
    if (!start) continue;
    const liveTag = tageSeit(start);
    if (liveTag == null || liveTag < MIN_LIVE_TAG) continue;
    const cur = byKunde.get(p.kunde_id);
    if (!cur || liveTag > cur.liveTag) byKunde.set(p.kunde_id, { projekt_id: p.id, liveTag });
  }
  if (!byKunde.size) return [];

  const kundeIds = [...byKunde.keys()];
  const { data: kunden } = await supabase.from('talentone_kunden')
    .select('id, firmenname, ansprechpartner, email, agentur, anrede_form, anrede_titel, nachname, close_lead_id, feedback_mails, feedback_token, feedback_mail_zuletzt_am, feedback_unbeantwortet, archiviert')
    .in('id', kundeIds);

  const kandidaten = [];
  for (const k of (kunden || [])) {
    if (k.archiviert) continue;
    if (k.agentur !== 'talentone') continue;          // nur TalentOne
    if (k.feedback_mails === false) continue;         // pro Kunde abschaltbar
    if (!k.email) continue;
    // Rhythmus: 7 Tage, nach 2× unbeantwortet 14 Tage.
    const intervalTage = (k.feedback_unbeantwortet || 0) >= 2 ? 14 : 7;
    const seit = tageSeit(k.feedback_mail_zuletzt_am);
    if (seit != null && seit < intervalTage) continue;
    const info = byKunde.get(k.id);
    kandidaten.push({ kunde: k, projekt_id: info.projekt_id, liveTag: info.liveTag });
  }
  return kandidaten;
}

async function processOne({ kunde, liveTag }) {
  try {
    let token = kunde.feedback_token;
    if (!token) {
      token = randomUUID();
      await supabase.from('talentone_kunden').update({ feedback_token: token }).eq('id', kunde.id);
    }
    const feedbackUrl = `${getPublicBaseUrl(kunde.agentur)}/feedback/${token}`;
    await sendFeedbackAnfrage({ to: kunde.email, kunde, liveTage: liveTag, feedbackUrl });
    // 1×/Woche-Sperre setzen + Unbeantwortet-Zähler hochzählen (Reset erfolgt beim
    // Absenden des Formulars).
    await supabase.from('talentone_kunden').update({
      feedback_mail_zuletzt_am: new Date().toISOString(),
      feedback_unbeantwortet: (kunde.feedback_unbeantwortet || 0) + 1,
    }).eq('id', kunde.id);
    console.log(`[weekly-feedback] ${kunde.id.slice(0, 8)} — Feedback-Mail versandt (Live-Tag ${liveTag})`);
    return { kunde_id: kunde.id, sent: true };
  } catch (err) {
    console.warn(`[weekly-feedback] ${kunde.id.slice(0, 8)} fehlgeschlagen:`, err.message);
    return { kunde_id: kunde.id, sent: false, error: err.message };
  }
}

export async function runWeeklyFeedback() {
  if (running) return { skipped: true };
  running = true;
  const t0 = Date.now();
  try {
    const kandidaten = await fetchCandidates();
    const results = [];
    for (const c of kandidaten) results.push(await processOne(c));
    const sent = results.filter(r => r.sent).length;
    lastResult = { checked: kandidaten.length, sent, results, duration_ms: Date.now() - t0 };
    lastRunAt = new Date().toISOString();
    console.log(`[weekly-feedback] Runde fertig — ${kandidaten.length} geprüft, ${sent} versendet`);
    return lastResult;
  } finally { running = false; }
}

export function getWeeklyFeedbackStatus() {
  return { running, last_run_at: lastRunAt, last_result: lastResult };
}

export function startWeeklyFeedbackScheduler() {
  const CHECK_MS = 60 * 60 * 1000;
  const INIT_MS = 250 * 1000;
  const check = () => {
    const now = new Date();
    const wd = now.toLocaleString('en-US', { weekday: 'short', timeZone: 'Europe/Berlin' });
    const hour = Number(now.toLocaleString('de-DE', { hour: '2-digit', hour12: false, timeZone: 'Europe/Berlin' }));
    if (wd !== 'Fri' || hour !== 10) return;
    runWeeklyFeedback().catch(err => console.error('[weekly-feedback]', err.message));
  };
  setTimeout(() => { check(); setInterval(check, CHECK_MS); }, INIT_MS);
  console.log('[weekly-feedback] Scheduler aktiv (freitags 10:00 Berlin).');
}
