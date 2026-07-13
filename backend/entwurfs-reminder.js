// 7-Tage-Erinnerung an das Team: welche Entwuerfe warten seit ≥7 Tagen auf
// eine Kundenreaktion? Taeglich um 09:00 Berlin — genau ein Team-Alert pro
// Review, gesteuert ueber talentone_reviews.reminder_intern_gesendet_at.

import { supabase } from './supabase.js';
import { sendTeamAlertMail } from './mail.js';

let running = false;
let lastRunAt = null;
let lastResult = null;

const INSIDE_BASE = process.env.INSIDE_BASE_URL || 'https://inside.talent-one.de';
const SCHWELLE_TAGE = 7;

async function fetchCandidates() {
  // 1) Alle Entwurfs-Versendungen mit typ startet mit 'entwurf' (inkl. entwurf_runde_N)
  const seit = new Date(Date.now() - SCHWELLE_TAGE * 86400000).toISOString();
  const { data: versand } = await supabase
    .from('talentone_versand')
    .select('id, job_id, typ, created_at, empfaenger')
    .like('typ', 'entwurf_runde_%')
    .lt('created_at', seit)
    .order('created_at', { ascending: false });
  if (!versand?.length) return [];

  // Pro Job: nur der jüngste Entwurfsversand ist relevant.
  const juengsterProJob = new Map();
  for (const v of versand) {
    if (!juengsterProJob.has(v.job_id)) juengsterProJob.set(v.job_id, v);
  }

  const kandidaten = [];
  for (const [jobId, v] of juengsterProJob.entries()) {
    // Aktueller Review (hoechste runde)
    const { data: review } = await supabase
      .from('talentone_reviews')
      .select('id, runde, status, manuell_beantwortet, reminder_intern_gesendet_at')
      .eq('job_id', jobId)
      .order('runde', { ascending: false }).limit(1).maybeSingle();

    // Filter: noch keine Kunden-Reaktion UND noch kein interner Reminder
    if (!review) {
      // Es gab noch gar kein Review — der Versand ist ≥7 Tage her → Kandidat.
    } else {
      // Bereits reagiert (freigegeben/aenderungen) oder manuell geantwortet? → skip
      if (review.status && review.status !== 'offen') continue;
      if (review.manuell_beantwortet) continue;
      if (review.reminder_intern_gesendet_at) continue;
    }
    kandidaten.push({ versand: v, review });
  }
  return kandidaten;
}

async function processOne({ versand, review }) {
  const jobId = versand.job_id;
  const { data: job } = await supabase.from('talentone_jobs')
    .select('id, stelle, kunde_id').eq('id', jobId).maybeSingle();
  if (!job) return { jobId, sent: false, error: 'Job nicht gefunden' };

  const { data: kunde } = await supabase.from('talentone_kunden')
    .select('id, firmenname').eq('id', job.kunde_id).maybeSingle();
  const { data: projekt } = await supabase.from('talentone_projekte')
    .select('id').eq('kunde_id', job.kunde_id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();

  const firma = kunde?.firmenname || 'Kunde';
  const stelle = job.stelle || 'Stelle';
  const versandDatum = new Date(versand.created_at).toLocaleDateString('de-DE');
  const tage = Math.floor((Date.now() - new Date(versand.created_at).getTime()) / 86400000);
  const link = projekt ? `${INSIDE_BASE}/projekte?open=${projekt.id}` : INSIDE_BASE;

  try {
    await sendTeamAlertMail({
      subject:   `⏳ ${firma} hat Entwürfe seit ${tage} Tagen nicht freigegeben`,
      headline:  `Entwürfe warten auf Freigabe — ${tage} Tage ohne Reaktion`,
      lead:      `${firma} · ${stelle}\n\nEntwürfe gesendet am ${versandDatum} an ${versand.empfaenger || '—'}. Der Kunde hat weder freigegeben noch Änderungswünsche geschickt.`,
      linkUrl:   link,
      linkLabel: 'Zum Projekt',
    });
    // Reminder-Flag setzen — pro Review nur einmal
    if (review?.id) {
      await supabase.from('talentone_reviews')
        .update({ reminder_intern_gesendet_at: new Date().toISOString() })
        .eq('id', review.id);
    } else {
      // Kein Review existiert — wir legen einen Stub mit runde=0 an, damit
      // wir den Reminder-Zustand persistieren. Das Public-Review-Endpoint
      // ersetzt/upgraded den Datensatz wenn der Kunde spaeter reagiert.
      const { randomUUID } = await import('node:crypto');
      await supabase.from('talentone_reviews').insert({
        job_id: jobId, token: randomUUID(),
        status: 'offen', runde: 0,
        reminder_intern_gesendet_at: new Date().toISOString(),
      });
    }
    console.log(`[entwurfs-reminder] ${jobId.slice(0,8)} — Team-Alert versandt (${tage} Tage)`);
    return { jobId, sent: true };
  } catch (err) {
    console.warn(`[entwurfs-reminder] ${jobId.slice(0,8)} fehlgeschlagen:`, err.message);
    return { jobId, sent: false, error: err.message };
  }
}

export async function runEntwurfsReminderRound() {
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
    console.log(`[entwurfs-reminder] Runde fertig — ${kandidaten.length} geprüft, ${sent} versendet`);
    return lastResult;
  } finally { running = false; }
}

export function getEntwurfsReminderStatus() {
  return { running, last_run_at: lastRunAt, last_result: lastResult };
}

/**
 * Scheduler: stuendlich pruefen, nur um 09:00 Berlin ausloesen (wie
 * live-termin-reminder).
 */
export function startEntwurfsReminderScheduler() {
  const CHECK_MS = 60 * 60 * 1000;
  const INIT_MS  = 210 * 1000;
  const check = () => {
    const now = new Date();
    const berlinHour = Number(now.toLocaleString('de-DE', { hour: '2-digit', hour12: false, timeZone: 'Europe/Berlin' }));
    if (berlinHour !== 9) return;
    runEntwurfsReminderRound().catch(err => console.error('[entwurfs-reminder]', err.message));
  };
  setTimeout(() => { check(); setInterval(check, CHECK_MS); }, INIT_MS);
  console.log('[entwurfs-reminder] Scheduler aktiv (täglich 09:00 Berlin).');
}
