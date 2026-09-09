// 30/60/90-Tage-Kampagnen-Reminder — täglich ~08:00 Berlin.
// Über alle VERKNÜPFTEN (jobs.projekt_id), AKTIVEN Kampagnen (status='live',
// nicht pausiert_seit). Laufzeit ab dem gepflegten Startfeld:
// coalesce(live_termin, start_phase1, startdatum_abo) — live_termin ist real nie
// befüllt, fällt daher auf start_phase1.
// Bei Erreichen eines 30er-Meilensteins (30/60/90/…) eine interne Sammel-Mail an
// info@nowagwirth.de. Doppelversand-Schutz über talentone_projekte.kampagnen_reminder_letzter
// (Datum) — NICHT reminder_gesendet_at (anderer Mechanismus). Meilenstein-robust:
// verschickt jeden Meilenstein genau einmal, auch nach Cron-Ausfall (Catch-up),
// ohne je doppelt zu senden.

import { supabase } from './supabase.js';

const RESEND_API = 'https://api.resend.com/emails';
const INSIDE_BASE = process.env.INSIDE_BASE_URL || 'https://inside.talent-one.de';
const EMPFAENGER = 'info@nowagwirth.de';

let running = false;
let lastRunAt = null;
let lastResult = null;

function escape(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function toDate(v) { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : d; }
function ymd(d) { return d.toISOString().slice(0, 10); }
function tageZwischen(a, b) { return Math.floor((b - a) / 86400000); }

// Ermittelt fällige Kampagnen (reine Berechnung, testbar). today optional (Date).
// nurProjektId: optionaler Filter — nur dieses eine Projekt prüfen (für kontrollierte Tests).
export async function ermittleFaelligeKampagnen(today = new Date(), nurProjektId = null) {
  today.setHours(12, 0, 0, 0); // Mittag → keine DST-/Zeitzonen-Grenzfälle bei Tagesdiff

  // Verknüpfte Jobs (projekt_id gesetzt) → Projekt-IDs + erster Job je Projekt (für Direktlink).
  const { data: jobs } = await supabase.from('talentone_jobs')
    .select('id, stelle, kunde_id, projekt_id').not('projekt_id', 'is', null);
  const jobByProjekt = {};
  for (const j of jobs || []) if (!jobByProjekt[j.projekt_id]) jobByProjekt[j.projekt_id] = j;
  let projektIds = Object.keys(jobByProjekt);
  if (nurProjektId) projektIds = projektIds.filter(id => id === nurProjektId);
  if (!projektIds.length) return [];

  const { data: projekte } = await supabase.from('talentone_projekte')
    .select('id, projekt, kunde, kunde_id, status, pausiert_seit, werbekosten, re_bezahlt, re2_bezahlt, live_termin, start_phase1, startdatum_abo, kampagnen_reminder_letzter')
    .in('id', projektIds)
    .eq('status', 'live')
    .is('pausiert_seit', null);

  const faellig = [];
  for (const p of projekte || []) {
    const start = toDate(p.live_termin) || toDate(p.start_phase1) || toDate(p.startdatum_abo);
    if (!start) continue;
    start.setHours(12, 0, 0, 0);
    const lauftage = tageZwischen(start, today);
    if (lauftage < 30) continue;
    const meilenstein = Math.floor(lauftage / 30) * 30; // 30/60/90…
    // Datum, an dem dieser Meilenstein erreicht wurde (tagesgenau vergleichen):
    const meilensteinDatum = new Date(start.getTime() + meilenstein * 86400000);
    // Für diesen Meilenstein schon erinnert? (letzter >= Meilenstein-Tag) → skip.
    // Tagesgenauer ymd-Vergleich (letzter ist ein DATE ohne Uhrzeit).
    if (p.kampagnen_reminder_letzter && ymd(meilensteinDatum) <= String(p.kampagnen_reminder_letzter).slice(0, 10)) continue;
    faellig.push({ projekt: p, job: jobByProjekt[p.id], lauftage, meilenstein });
  }
  return faellig;
}

function renderMail(faellig, datumLabel) {
  const rows = faellig.map(({ projekt: p, job, lauftage, meilenstein }) => {
    const wk = p.werbekosten === 'N&W' ? 'N&W' : p.werbekosten === 'Kunde' ? 'Kunde' : '—';
    const re = p.re_bezahlt ? '✅' : '❌';
    const re2 = p.re2_bezahlt ? '✅' : '❌';
    const link = `${INSIDE_BASE}/kunden/${p.kunde_id}/jobs/${job.id}/stelle`;
    return `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #ececea;font-size:13px;">${escape(p.kunde || '—')}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #ececea;font-size:13px;">${escape(p.projekt || job.stelle || '—')}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #ececea;font-size:13px;text-align:right;"><strong>${lauftage}</strong> (Meilenstein ${meilenstein})</td>
      <td style="padding:8px 10px;border-bottom:1px solid #ececea;font-size:13px;">${wk}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #ececea;font-size:13px;">RE ${re} · RE2 ${re2}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #ececea;font-size:13px;"><a href="${escape(link)}">öffnen →</a></td>
    </tr>`;
  }).join('');
  return `<!doctype html><html><body style="font-family:-apple-system,Arial,sans-serif;color:#0a0a0a;">
    <div style="max-width:760px;margin:0 auto;padding:16px;">
      <h2 style="margin:0 0 4px;">⏱️ Kampagnen-Laufzeit-Reminder</h2>
      <p style="font-size:13px;color:#5a5955;margin:0 0 16px;">${datumLabel} · ${faellig.length} Kampagne${faellig.length === 1 ? '' : 'n'} an einem 30-Tage-Meilenstein — Folgerechnung prüfen.</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <thead><tr>
          <th style="padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;color:#5a5955;">Kunde</th>
          <th style="padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;color:#5a5955;">Projekt</th>
          <th style="padding:8px 10px;text-align:right;font-size:11px;text-transform:uppercase;color:#5a5955;">Lauftage</th>
          <th style="padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;color:#5a5955;">Werbekosten</th>
          <th style="padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;color:#5a5955;">Rechnungen</th>
          <th style="padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;color:#5a5955;">Link</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div></body></html>`;
}

export async function runCampaignReminder({ apply = true, nurProjektId = null } = {}) {
  if (running) return { skipped: true, reason: 'running' };
  running = true;
  const t0 = Date.now();
  try {
    const today = new Date();
    const faellig = await ermittleFaelligeKampagnen(today, nurProjektId);
    if (!faellig.length) {
      lastResult = { faellig: 0, sent: false, reason: 'nichts_faellig', duration_ms: Date.now() - t0 };
      lastRunAt = new Date().toISOString();
      return lastResult;
    }
    const datumLabel = today.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    // Betreff im gewünschten Stil; bei mehreren Kampagnen den ersten Kunden + Zähler.
    const ersterKunde = faellig[0].projekt.kunde || faellig[0].job?.stelle || 'Kampagne';
    const subject = faellig.length === 1
      ? `Kampagne läuft seit ${faellig[0].lauftage} Tagen — Folgerechnung prüfen: ${ersterKunde}`
      : `${faellig.length} Kampagnen an einem 30-Tage-Meilenstein — Folgerechnungen prüfen`;
    const html = renderMail(faellig, datumLabel);

    let sent = false;
    if (apply && process.env.RESEND_API_KEY) {
      const res = await fetch(RESEND_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
        body: JSON.stringify({ from: 'TalentOne Reports <reports@talent-one.de>', to: [EMPFAENGER], subject, html }),
      });
      sent = res.ok;
      if (!res.ok) console.warn(`[campaign-reminder] Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    // Doppelversand-Schutz: nur nach echtem Versand die Marke setzen.
    if (apply && sent) {
      const heute = ymd(new Date());
      for (const f of faellig) {
        await supabase.from('talentone_projekte').update({ kampagnen_reminder_letzter: heute }).eq('id', f.projekt.id);
      }
    }
    lastResult = { faellig: faellig.length, sent, subject, duration_ms: Date.now() - t0 };
    lastRunAt = new Date().toISOString();
    console.log(`[campaign-reminder] ${faellig.length} fällig — ${sent ? 'gesendet' : 'nicht gesendet'}`);
    return lastResult;
  } finally { running = false; }
}

export function getCampaignReminderStatus() {
  return { running, last_run_at: lastRunAt, last_result: lastResult };
}

/** Scheduler: stündlich prüfen, nur um 08:00 Berlin auslösen. */
export function startCampaignReminderScheduler() {
  const CHECK_MS = 60 * 60 * 1000;
  const INIT_MS = 300 * 1000;
  const check = () => {
    const berlinHour = Number(new Date().toLocaleString('de-DE', { hour: '2-digit', hour12: false, timeZone: 'Europe/Berlin' }));
    if (berlinHour !== 8) return;
    runCampaignReminder().catch(err => console.error('[campaign-reminder]', err.message));
  };
  setTimeout(() => { check(); setInterval(check, CHECK_MS); }, INIT_MS);
  console.log('[campaign-reminder] Scheduler aktiv (täglich 08:00 Berlin).');
}
