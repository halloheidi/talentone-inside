// Woechentlicher Bewerbungs-Report — Montag 07:30 Berlin.
// Zeitraum: letzte 7 Tage (Mo-So) vs. Vorwoche.
// Sortierung: Bewerbungen diese Woche desc.
// Zusammenfassung: Gesamt, bester Performer, Live-Projekte mit 0 Bewerbungen.
// Wird SEPARAT vom weekly-close-summary (08:00 Berlin) verschickt.

import { supabase } from './supabase.js';
import { getNotificationRecipients } from './mail.js';

const RESEND_API = 'https://api.resend.com/emails';
const INSIDE_BASE = process.env.INSIDE_BASE_URL || 'https://inside.talent-one.de';
const AGENTUR_BASE = { talentone: 'https://recruiting.talent-one.de', nowagwirth: 'https://recruiting.nowagwirth.com' };

let running = false;
let lastRunAt = null;
let lastResult = null;

function escape(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function kwFor(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

async function collectRows() {
  const now = new Date();
  const seit7 = new Date(now.getTime() - 7 * 86400000).toISOString();
  const seit14 = new Date(now.getTime() - 14 * 86400000).toISOString();

  // Live-Projekte + alle Kunden mit Bewerbungen der letzten 14 Tage
  const { data: liveProjekte = [] } = await supabase.from('talentone_projekte')
    .select('id, kunde_id, projekt, status, start_phase1, live_seit')
    .eq('status', 'live');

  const { data: recentB = [] } = await supabase.from('talentone_bewerbungen')
    .select('id, job_id, ko_kriterium, created_at')
    .gte('created_at', seit14);

  let jobsMitB = new Set(recentB.map(b => b.job_id));
  let kundeIds = new Set(liveProjekte.map(p => p.kunde_id).filter(Boolean));
  if (jobsMitB.size) {
    const { data: jobs = [] } = await supabase.from('talentone_jobs')
      .select('id, kunde_id').in('id', Array.from(jobsMitB));
    for (const j of jobs) kundeIds.add(j.kunde_id);
  }

  kundeIds = Array.from(kundeIds);
  if (!kundeIds.length) return { rows: [], totalWoche: 0, deltaWoche: 0 };

  const { data: kunden = [] } = await supabase.from('talentone_kunden')
    .select('id, firmenname, agentur').in('id', kundeIds);
  const kById = Object.fromEntries(kunden.map(k => [k.id, k]));

  const { data: allJobs = [] } = await supabase.from('talentone_jobs')
    .select('id, kunde_id, stelle, bewerbungen_token').in('kunde_id', kundeIds);

  const rows = [];
  let totalWoche = 0;
  let totalVorwoche = 0;

  for (const kId of kundeIds) {
    const k = kById[kId];
    if (!k) continue;
    const jobs = allJobs.filter(j => j.kunde_id === kId);
    if (!jobs.length) continue;
    const jobIds = jobs.map(j => j.id);
    const projekt = liveProjekte.find(p => p.kunde_id === kId);

    const { data: bAll = [] } = await supabase.from('talentone_bewerbungen')
      .select('id, job_id, ko_kriterium, created_at').in('job_id', jobIds);

    const woche = bAll.filter(b => b.created_at >= seit7);
    const vorwoche = bAll.filter(b => b.created_at >= seit14 && b.created_at < seit7);
    const wocheN = woche.length;
    const vorwocheN = vorwoche.length;
    const qualWoche = woche.filter(b => !b.ko_kriterium).length;
    const gesamt = bAll.length;
    totalWoche += wocheN;
    totalVorwoche += vorwocheN;

    if (!projekt && wocheN === 0) continue;

    let tagX = null;
    if (projekt) {
      const start = projekt.start_phase1 || projekt.live_seit;
      if (start) tagX = Math.floor((now.getTime() - new Date(start).getTime()) / 86400000);
    }
    // Primaeren Job auswaehlen (mit den meisten Bewerbungen diese Woche)
    const jobsWithCount = jobs.map(j => ({
      j, w: woche.filter(b => b.job_id === j.id).length,
    })).sort((a, b) => b.w - a.w);
    const primary = jobsWithCount[0].j;
    const link = primary.bewerbungen_token
      ? `${AGENTUR_BASE[k.agentur] || AGENTUR_BASE.talentone}/bewerbungen/${primary.bewerbungen_token}`
      : `${INSIDE_BASE}/kunden/${k.id}/jobs/${primary.id}/export`;

    const delta = wocheN - vorwocheN;
    const deltaLabel = delta > 0 ? `+${delta} ▲` : delta < 0 ? `${delta} ▼` : '±0';

    rows.push({
      kunde: k.firmenname,
      stelle: primary.stelle || '—',
      wocheN, qualWoche, deltaLabel, delta,
      gesamt, tagX, istLive: !!projekt,
      link,
    });
  }

  rows.sort((a, b) => b.wocheN - a.wocheN || (b.gesamt - a.gesamt));

  return { rows, totalWoche, deltaWoche: totalWoche - totalVorwoche };
}

function renderMail({ rows, totalWoche, deltaWoche, kw }) {
  const bestPerformer = rows.filter(r => r.wocheN > 0).sort((a, b) => b.wocheN - a.wocheN)[0];
  const stille = rows.filter(r => r.istLive && r.wocheN === 0);
  const deltaLabel = deltaWoche > 0 ? `+${deltaWoche} ▲` : deltaWoche < 0 ? `${deltaWoche} ▼` : '±0';

  const rowsHtml = rows.map(r => `
    <tr style="border-bottom:1px solid #ececea;${r.istLive && r.wocheN === 0 ? 'background:#fef2f2;' : ''}">
      <td style="padding:8px 10px;font-size:13px;font-weight:600;color:#0a0a0a;">${escape(r.kunde)}</td>
      <td style="padding:8px 10px;font-size:12px;color:#5a5955;">${escape(r.stelle)}</td>
      <td style="padding:8px 10px;font-size:13px;text-align:center;font-weight:700;color:${r.wocheN > 0 ? '#166534' : '#b91c1c'};">${r.wocheN}</td>
      <td style="padding:8px 10px;font-size:13px;text-align:center;color:#0a0a0a;">${r.qualWoche}</td>
      <td style="padding:8px 10px;font-size:12px;text-align:center;color:${r.delta > 0 ? '#166534' : r.delta < 0 ? '#b91c1c' : '#9a9994'};">${escape(r.deltaLabel)}</td>
      <td style="padding:8px 10px;font-size:13px;text-align:center;color:#0a0a0a;">${r.gesamt}</td>
      <td style="padding:8px 10px;font-size:11px;color:${r.istLive ? '#166534' : '#5a5955'};">${r.istLive ? `🟢 Live${r.tagX != null ? ` · Tag ${r.tagX}/30` : ''}` : '—'}</td>
      <td style="padding:8px 10px;font-size:11px;text-align:right;"><a href="${escape(r.link)}" style="color:#3b82f6;text-decoration:none;">Öffnen →</a></td>
    </tr>`).join('');

  const stilleHtml = stille.length
    ? `<div style="margin-top:16px;padding:12px 14px;background:#fef2f2;border-left:3px solid #b91c1c;border-radius:8px;">
         <strong style="color:#b91c1c;">⚠️ Live-Projekte ohne Bewerbungen die ganze Woche:</strong>
         <ul style="margin:6px 0 0;font-size:13px;">${stille.map(s => `<li>${escape(s.kunde)} — ${escape(s.stelle)}</li>`).join('')}</ul>
       </div>`
    : '';

  return `<!doctype html><html><body style="margin:0;padding:20px;background:#f7f6f2;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">
    <div style="max-width:900px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
      <h1 style="margin:0 0 4px;font-size:22px;color:#0a0a0a;">📈 Wochen-Report KW ${kw}</h1>
      <p style="margin:0 0 18px;font-size:14px;color:#5a5955;">
        <strong>${totalWoche}</strong> Bewerbung${totalWoche === 1 ? '' : 'en'} diese Woche · Vorwoche ${deltaLabel}
        ${bestPerformer ? ` · Bester Performer 🏆 <strong>${escape(bestPerformer.kunde)}</strong> (${bestPerformer.wocheN})` : ''}
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#fafaf8;border-bottom:2px solid #ececea;">
            <th style="padding:10px;text-align:left;font-size:11px;letter-spacing:0.05em;text-transform:uppercase;color:#5a5955;">Kunde</th>
            <th style="padding:10px;text-align:left;font-size:11px;letter-spacing:0.05em;text-transform:uppercase;color:#5a5955;">Stelle</th>
            <th style="padding:10px;text-align:center;font-size:11px;letter-spacing:0.05em;text-transform:uppercase;color:#5a5955;">Woche</th>
            <th style="padding:10px;text-align:center;font-size:11px;letter-spacing:0.05em;text-transform:uppercase;color:#5a5955;">Qualifiz.</th>
            <th style="padding:10px;text-align:center;font-size:11px;letter-spacing:0.05em;text-transform:uppercase;color:#5a5955;">Δ Vorwoche</th>
            <th style="padding:10px;text-align:center;font-size:11px;letter-spacing:0.05em;text-transform:uppercase;color:#5a5955;">Gesamt</th>
            <th style="padding:10px;text-align:left;font-size:11px;letter-spacing:0.05em;text-transform:uppercase;color:#5a5955;">Status</th>
            <th style="padding:10px;text-align:right;font-size:11px;letter-spacing:0.05em;text-transform:uppercase;color:#5a5955;">Link</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      ${stilleHtml}
    </div>
  </body></html>`;
}

async function sendMail({ subject, html }) {
  if (!process.env.RESEND_API_KEY) return null;
  const recipients = getNotificationRecipients();
  if (!recipients.length) return null;
  const from = 'TalentOne Reports <reports@talent-one.de>';
  const res = await fetch(RESEND_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({ from, to: recipients, subject, html }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.warn(`[weekly-bewerbungs-report] Resend ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.ok;
}

export async function runWeeklyBewerbungsReport() {
  if (running) return { skipped: true };
  running = true;
  const t0 = Date.now();
  try {
    const { rows, totalWoche, deltaWoche } = await collectRows();
    if (!rows.length && totalWoche === 0) {
      lastResult = { checked: 0, sent: false, reason: 'no_data', duration_ms: Date.now() - t0 };
      lastRunAt = new Date().toISOString();
      console.log('[weekly-bewerbungs-report] Nichts los — Mail übersprungen.');
      return lastResult;
    }
    const kw = kwFor(new Date());
    const html = renderMail({ rows, totalWoche, deltaWoche, kw });
    const subject = `📈 Wochen-Report KW ${kw}: ${totalWoche} Bewerbung${totalWoche === 1 ? '' : 'en'} gesamt`;
    const sent = await sendMail({ subject, html });
    lastResult = { checked: rows.length, sent: !!sent, totalWoche, duration_ms: Date.now() - t0 };
    lastRunAt = new Date().toISOString();
    console.log(`[weekly-bewerbungs-report] ${rows.length} Zeilen, ${totalWoche} Woche — ${sent ? 'gesendet' : 'Fehler'}`);
    return lastResult;
  } finally { running = false; }
}

export function getWeeklyBewerbungsReportStatus() {
  return { running, last_run_at: lastRunAt, last_result: lastResult };
}

/** Scheduler: stuendlich pruefen, nur Montag 07:30 Berlin ausloesen.
 * 07:30 ist die 8. Stunde (07:00-08:00) mit Minuten-Bedingung. */
export function startWeeklyBewerbungsReportScheduler() {
  const CHECK_MS = 15 * 60 * 1000;   // alle 15 Min pruefen — sonst verpasst
  const INIT_MS  = 280 * 1000;
  let letzterLaufTag = null;
  const check = () => {
    const now = new Date();
    const berlinWeekday = now.toLocaleString('en-US', { weekday: 'short', timeZone: 'Europe/Berlin' });
    if (berlinWeekday !== 'Mon') return;
    const berlinHour = Number(now.toLocaleString('de-DE', { hour: '2-digit', hour12: false, timeZone: 'Europe/Berlin' }));
    const berlinMin  = Number(now.toLocaleString('de-DE', { minute: '2-digit', timeZone: 'Europe/Berlin' }));
    // Fenster 07:30–07:45 Berlin, ein Lauf pro Tag
    if (berlinHour !== 7 || berlinMin < 30) return;
    const heute = now.toISOString().slice(0, 10);
    if (letzterLaufTag === heute) return;
    letzterLaufTag = heute;
    runWeeklyBewerbungsReport().catch(err => console.error('[weekly-bewerbungs-report]', err.message));
  };
  setTimeout(() => { check(); setInterval(check, CHECK_MS); }, INIT_MS);
  console.log('[weekly-bewerbungs-report] Scheduler aktiv (montags 07:30 Berlin).');
}
