// Wöchentlicher Close-CRM-Cron: Montag 08:00 Berlin.
// Für jedes Live-Projekt mit close_lead_id am Kunden eine Notiz erstellen:
//   "📊 Wochenupdate: bisher X Bewerbungen ([Y] diese Woche), Z qualifiziert."

import { supabase } from './supabase.js';
import { notifyKunde } from './close.js';

let running = false;
let lastRunAt = null;
let lastResult = null;

async function collectAndSend() {
  // 1. Alle Live-Projekte laden
  const { data: liveProjekte, error } = await supabase.from('talentone_projekte')
    .select('id, kunde_id, projekt')
    .eq('status', 'live');
  if (error) throw new Error(error.message);
  if (!liveProjekte?.length) return { checked: 0, sent: 0 };

  // 2. Nur die mit Kunde + close_lead_id
  const kundeIds = [...new Set(liveProjekte.map(p => p.kunde_id).filter(Boolean))];
  if (!kundeIds.length) return { checked: liveProjekte.length, sent: 0 };
  const { data: kunden } = await supabase.from('talentone_kunden')
    .select('id, firmenname, close_lead_id, email')
    .in('id', kundeIds)
    .not('close_lead_id', 'is', null);
  const kundeById = Object.fromEntries((kunden || []).map(k => [k.id, k]));

  // 3. Pro Projekt: Jobs + Bewerbungen zählen
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);
  const weekStartIso = weekStart.toISOString();

  let sent = 0;
  const results = [];
  for (const projekt of liveProjekte) {
    const kunde = kundeById[projekt.kunde_id];
    if (!kunde) continue;

    // Jobs des Kunden
    const { data: jobs } = await supabase.from('talentone_jobs')
      .select('id').eq('kunde_id', kunde.id);
    const jobIds = (jobs || []).map(j => j.id);
    if (!jobIds.length) continue;

    // Alle Bewerbungen + Bewerbungen dieser Woche
    const { count: totalCount } = await supabase.from('talentone_bewerbungen')
      .select('id', { count: 'exact', head: true })
      .in('job_id', jobIds);
    const { count: weekCount } = await supabase.from('talentone_bewerbungen')
      .select('id', { count: 'exact', head: true })
      .in('job_id', jobIds).gte('created_at', weekStartIso);
    const { count: qualifiedCount } = await supabase.from('talentone_bewerbungen')
      .select('id', { count: 'exact', head: true })
      .in('job_id', jobIds).or('ko_kriterium.is.null,ko_kriterium.eq.false');

    const note = `📊 Wochenupdate: bisher ${totalCount || 0} Bewerbung(en) erhalten (${weekCount || 0} diese Woche), ${qualifiedCount || 0} qualifiziert (ohne KO). Stand: ${new Date().toLocaleDateString('de-DE')}`;
    const res = await notifyKunde(kunde, note);
    if (res.ok) sent++;
    results.push({ kunde_id: kunde.id, sent: res.ok, note });
  }
  return { checked: liveProjekte.length, sent, results };
}

export async function runWeeklyCloseSummary() {
  if (running) return { skipped: true };
  running = true;
  const t0 = Date.now();
  try {
    const r = await collectAndSend();
    lastResult = { ...r, duration_ms: Date.now() - t0 };
    lastRunAt = new Date().toISOString();
    console.log(`[weekly-close-summary] Runde fertig — ${r.checked} Projekte, ${r.sent} Notes gesendet`);
    return lastResult;
  } finally { running = false; }
}

export function getWeeklyCloseSummaryStatus() {
  return { running, last_run_at: lastRunAt, last_result: lastResult };
}

/**
 * Scheduler: initial +240s, danach stündlich prüfen; nur Montag 08:00 Berlin
 * tatsächlich auslösen. Idempotent nicht nötig — die Cron-Fenster-Prüfung
 * garantiert einen Lauf pro Woche.
 */
export function startWeeklyCloseSummaryScheduler() {
  const CHECK_MS = 60 * 60 * 1000;
  const INIT_MS  = 240 * 1000;
  const check = () => {
    const now = new Date();
    const berlinWeekday = now.toLocaleString('en-US', { weekday: 'short', timeZone: 'Europe/Berlin' }); // 'Mon'
    const berlinHour = Number(now.toLocaleString('de-DE', { hour: '2-digit', hour12: false, timeZone: 'Europe/Berlin' }));
    if (berlinWeekday !== 'Mon' || berlinHour !== 8) return;
    runWeeklyCloseSummary().catch(err => console.error('[weekly-close-summary]', err.message));
  };
  setTimeout(() => { check(); setInterval(check, CHECK_MS); }, INIT_MS);
  console.log('[weekly-close-summary] Scheduler aktiv (montags 08:00 Berlin).');
}
