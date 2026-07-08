// Live-Termin-Reminder-Cron (Migration 019 / T7).
//
// Zweck: jeden Werktag um 09:00 Berlin prüfen, welche Projekte einen
// `live_termin` in genau 2 Tagen haben, und pro Projekt einmal eine Team-
// Alert-Mail an info@nowagwirth.de + laura.mueller@nowagwirth.de senden.
// Idempotenz über die neue Spalte `reminder_gesendet_at`.

import { supabase } from './supabase.js';
import { sendTeamAlertMail } from './mail.js';

let running = false;
let lastRunAt = null;
let lastResult = null;

const INSIDE_BASE = process.env.INSIDE_BASE_URL || 'https://inside.talent-one.de';

function isoDate(d = new Date()) { return d.toISOString().slice(0, 10); }
function addDaysIso(days, from = new Date()) {
  const d = new Date(from); d.setDate(d.getDate() + days);
  return isoDate(d);
}

/**
 * Wählt Projekte, deren live_termin genau in 2 Tagen liegt und noch keinen
 * reminder_gesendet_at haben.
 */
async function fetchCandidates() {
  const targetIso = addDaysIso(2);
  const { data, error } = await supabase.from('talentone_projekte')
    .select('id, projekt, kunde, live_termin, reminder_gesendet_at')
    .eq('live_termin', targetIso)
    .is('reminder_gesendet_at', null);
  if (error) throw new Error(error.message);
  return data || [];
}

async function processOne(projekt) {
  const label = projekt.projekt || projekt.kunde || 'Projekt';
  const link  = `${INSIDE_BASE}/projekte?open=${projekt.id}`;
  try {
    await sendTeamAlertMail({
      subject:   `⏰ Go-Live von ${projekt.kunde || label} am ${new Date(projekt.live_termin).toLocaleDateString('de-DE')}`,
      headline:  `Go-Live in 2 Tagen — sind die Creatives fertig?`,
      lead:      `${label}${projekt.kunde ? ' · ' + projekt.kunde : ''} · geplanter Live-Termin: ${new Date(projekt.live_termin).toLocaleDateString('de-DE')}. Bitte prüfen, ob Creatives, Ad-Copies und Funnel bereitstehen.`,
      linkUrl:   link,
      linkLabel: 'Zum Projekt',
    });
    await supabase.from('talentone_projekte')
      .update({ reminder_gesendet_at: new Date().toISOString() })
      .eq('id', projekt.id);
    console.log(`[live-termin-reminder] ${projekt.id.slice(0, 8)} → Reminder versandt`);
    return { projektId: projekt.id, sent: true };
  } catch (err) {
    console.warn(`[live-termin-reminder] ${projekt.id.slice(0, 8)} fehlgeschlagen:`, err.message);
    return { projektId: projekt.id, sent: false, error: err.message };
  }
}

export async function runLiveTerminReminderRound() {
  if (running) return { skipped: true };
  running = true;
  const t0 = Date.now();
  try {
    const candidates = await fetchCandidates();
    const results = [];
    for (const p of candidates) results.push(await processOne(p));
    const sent = results.filter(r => r.sent).length;
    lastResult = { checked: candidates.length, sent, results, duration_ms: Date.now() - t0 };
    lastRunAt = new Date().toISOString();
    console.log(`[live-termin-reminder] Runde fertig — ${candidates.length} geprüft, ${sent} versendet`);
    return lastResult;
  } finally { running = false; }
}

export function getLiveTerminReminderStatus() {
  return { running, last_run_at: lastRunAt, last_result: lastResult };
}

/**
 * Scheduler: initial +180s, danach stündlich prüfen; nur um 09:00 Berlin
 * tatsächlich Reminder auslösen (analog billing-reminder).
 */
export function startLiveTerminReminderScheduler() {
  const CHECK_MS = 60 * 60 * 1000;
  const INIT_MS  = 180 * 1000;
  const check = () => {
    const now = new Date();
    const berlinHour = Number(now.toLocaleString('de-DE', { hour: '2-digit', hour12: false, timeZone: 'Europe/Berlin' }));
    if (berlinHour !== 9) return;
    runLiveTerminReminderRound().catch(err => console.error('[live-termin-reminder]', err.message));
  };
  setTimeout(() => { check(); setInterval(check, CHECK_MS); }, INIT_MS);
  console.log('[live-termin-reminder] Scheduler aktiv (täglich 09:00 Berlin).');
}
