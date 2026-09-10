// Taeglicher Bewerbungs-Report um 07:00 Berlin.
// - Live-Projekte + Projekte mit Bewerbungseingang der letzten 24h
// - HTML-Tabelle sortiert: neue Bewerbungen zuerst, danach Live-Kunden mit 0
// - ⚠️ Warnung wenn Live-Projekt seit 2+ Tagen keine Bewerbungen bekommt
// - Wenn nichts los ist: Mail wird uebersprungen (kein Spam)

import { supabase } from './supabase.js';
import { getNotificationRecipients } from './mail.js';
import { metaMetrikenBatch, garantieStatus } from './meta-metriken.js';

const RESEND_API = 'https://api.resend.com/emails';
const INSIDE_BASE = process.env.INSIDE_BASE_URL || 'https://inside.talent-one.de';
const AGENTUR_BASE = { talentone: 'https://recruiting.talent-one.de', nowagwirth: 'https://recruiting.nowagwirth.com' };

let running = false;
let lastRunAt = null;
let lastResult = null;

function escape(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function collectRows() {
  const seit24h  = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const seit48h  = new Date(Date.now() - 48 * 3600 * 1000).toISOString();

  // Live-Projekte
  const { data: liveProjekte = [] } = await supabase.from('talentone_projekte')
    .select('id, kunde_id, projekt, status, start_phase1, live_seit')
    .eq('status', 'live');

  const liveKundeIds = new Set(liveProjekte.map(p => p.kunde_id).filter(Boolean));

  // Bewerbungen der letzten 24h -> welche Jobs betrifft es?
  const { data: neueB = [] } = await supabase.from('talentone_bewerbungen')
    .select('id, job_id, quelle, ko_kriterium, created_at')
    .gte('created_at', seit24h);
  const jobsMitNeuen = new Set(neueB.map(b => b.job_id));

  // Von diesen Jobs die kunde_ids sammeln
  let bewerbungsKundeIds = new Set();
  if (jobsMitNeuen.size) {
    const { data: jobs = [] } = await supabase.from('talentone_jobs')
      .select('id, kunde_id').in('id', Array.from(jobsMitNeuen));
    for (const j of jobs) bewerbungsKundeIds.add(j.kunde_id);
  }

  const kundeIds = Array.from(new Set([...liveKundeIds, ...bewerbungsKundeIds]));
  if (!kundeIds.length) return { rows: [], neu24hTotal: 0 };

  const { data: kunden = [] } = await supabase.from('talentone_kunden')
    .select('id, firmenname, agentur').in('id', kundeIds);
  const kundeById = Object.fromEntries(kunden.map(k => [k.id, k]));

  const { data: jobs = [] } = await supabase.from('talentone_jobs')
    .select('id, kunde_id, stelle, bewerbungen_token').in('kunde_id', kundeIds);

  const rows = [];
  let neu24hTotal = 0;

  for (const kId of kundeIds) {
    const kunde = kundeById[kId];
    if (!kunde) continue;
    const kJobs = jobs.filter(j => j.kunde_id === kId);
    if (!kJobs.length) continue;
    const jobIds = kJobs.map(j => j.id);
    const projekt = liveProjekte.find(p => p.kunde_id === kId);

    // Zaehlungen
    const { data: bAll = [] } = await supabase.from('talentone_bewerbungen')
      .select('id, quelle, ko_kriterium, created_at').in('job_id', jobIds);
    const gesamt = bAll.length;
    const neu24h = bAll.filter(b => b.created_at >= seit24h).length;
    const qualifiziert = bAll.filter(b => !b.ko_kriterium).length;
    const quellen = {};
    for (const b of bAll) quellen[b.quelle || 'unbekannt'] = (quellen[b.quelle || 'unbekannt'] || 0) + 1;
    const letzteBewerbung = bAll.reduce((max, b) => (b.created_at > max ? b.created_at : max), '');

    const seit48hNichts = !bAll.some(b => b.created_at >= seit48h);
    const warnung = !!projekt && seit48hNichts;

    let tagX = null;
    if (projekt) {
      const start = projekt.start_phase1 || projekt.live_seit;
      if (start) tagX = Math.floor((Date.now() - new Date(start).getTime()) / 86400000);
    }

    neu24hTotal += neu24h;

    for (const j of kJobs) {
      const jNeu24h = bAll.filter(b => b.job_id === j.id && b.created_at >= seit24h).length;
      const jGesamt = bAll.filter(b => b.job_id === j.id).length;
      const jQual = bAll.filter(b => b.job_id === j.id && !b.ko_kriterium).length;
      if (!projekt && jGesamt === 0) continue; // kein Live-Projekt UND keine Bewerbungen
      const link = j.bewerbungen_token
        ? `${AGENTUR_BASE[kunde.agentur] || AGENTUR_BASE.talentone}/bewerbungen/${j.bewerbungen_token}`
        : `${INSIDE_BASE}/kunden/${kunde.id}/jobs/${j.id}/export`;
      rows.push({
        kunde: kunde.firmenname,
        stelle: j.stelle || '—',
        neu24h: jNeu24h,
        gesamt: jGesamt,
        qualifiziert: jQual,
        quellen: Object.entries(quellen).map(([q, n]) => `${q}: ${n}`).join(', '),
        istLive: !!projekt,
        tagX,
        warnung,
        letzteBewerbung,
        link,
      });
    }
  }

  // Sortierung: neu24h desc, dann warnung, dann kunde/stelle
  rows.sort((a, b) => {
    if (b.neu24h !== a.neu24h) return b.neu24h - a.neu24h;
    if (b.warnung !== a.warnung) return b.warnung ? 1 : -1;
    return (a.kunde || '').localeCompare(b.kunde || '');
  });

  return { rows, neu24hTotal };
}

// Budget-Wächter (≥80%/100% des Monatsbudgets) + Garantie-Hinweise (Fenster endet in
// ≤14 aktiven Lauftagen). Beides über LIVE-Projekte; Projekte ohne Budget/ohne Meta bleiben stumm.
async function collectMetaWarnungen() {
  const { data: live = [] } = await supabase.from('talentone_projekte')
    .select('id, kunde, kunde_id, projekt, status, monatsbudget_euro, garantie, garantie_details, phase1_einstellungen, phase2_einstellungen')
    .eq('status', 'live');
  if (!live.length) return { budgetWarnungen: [], garantieHinweise: [] };

  // Kundennamen (projekt.kunde ist teils leer).
  const kundeIds = [...new Set(live.map(p => p.kunde_id).filter(Boolean))];
  const { data: kunden = [] } = kundeIds.length
    ? await supabase.from('talentone_kunden').select('id, firmenname').in('id', kundeIds) : { data: [] };
  const kundeName = Object.fromEntries(kunden.map(k => [k.id, k.firmenname]));

  const metaMap = await metaMetrikenBatch(live.map(p => p.id));
  const budgetWarnungen = [], garantieHinweise = [];
  for (const p of live) {
    const m = metaMap.get(p.id) || null;
    const kunde = kundeName[p.kunde_id] || p.kunde || 'Unbekannt';
    // Budget: nur wenn Budget gesetzt UND Auslastung ≥ 80 %.
    if (m && m.budget && m.budget_prozent != null && m.budget_prozent >= 80) {
      budgetWarnungen.push({ kunde, projekt: p.projekt || '—', spend: m.spend_monat, budget: m.budget, prozent: m.budget_prozent });
    }
    // Garantie: Fenster endet in ≤14 aktiven Lauftagen (nur mit bekannter Phase).
    const gs = garantieStatus(p, m?.aktive_lauftage ?? null);
    if (gs.hat && gs.laeuft_aus) {
      garantieHinweise.push({ kunde, projekt: p.projekt || '—', text: gs.text, rest: gs.rest_tage, phase1: gs.phase1, phase2: gs.phase2 });
    }
  }
  budgetWarnungen.sort((a, b) => b.prozent - a.prozent);
  garantieHinweise.sort((a, b) => (a.rest ?? 99) - (b.rest ?? 99));
  return { budgetWarnungen, garantieHinweise };
}

function renderMetaSektionen({ budgetWarnungen, garantieHinweise }) {
  let html = '';
  if (budgetWarnungen.length) {
    const rows = budgetWarnungen.map(b => {
      const farbe = b.prozent >= 100 ? '#b91c1c' : '#b26b00';
      return `<tr style="border-bottom:1px solid #ececea;">
        <td style="padding:8px 10px;font-size:13px;font-weight:600;">${escape(b.kunde)}</td>
        <td style="padding:8px 10px;font-size:12px;color:#5a5955;">${escape(b.projekt)}</td>
        <td style="padding:8px 10px;font-size:13px;text-align:right;color:${farbe};font-weight:700;">${b.prozent}%</td>
        <td style="padding:8px 10px;font-size:12px;color:#5a5955;text-align:right;">${b.spend.toFixed(2)} € / ${Number(b.budget).toFixed(2)} €</td>
      </tr>`;
    }).join('');
    html += `<h2 style="margin:22px 0 6px;font-size:16px;color:#0a0a0a;">💸 Budget-Warnungen (Monat)</h2>
      <table style="width:100%;border-collapse:collapse;"><thead><tr style="background:#fafaf8;border-bottom:2px solid #ececea;">
        <th style="padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;color:#5a5955;">Kunde</th>
        <th style="padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;color:#5a5955;">Projekt</th>
        <th style="padding:8px 10px;text-align:right;font-size:11px;text-transform:uppercase;color:#5a5955;">Auslastung</th>
        <th style="padding:8px 10px;text-align:right;font-size:11px;text-transform:uppercase;color:#5a5955;">Spend / Budget</th>
      </tr></thead><tbody>${rows}</tbody></table>`;
  }
  if (garantieHinweise.length) {
    const rows = garantieHinweise.map(g => `<tr style="border-bottom:1px solid #ececea;">
        <td style="padding:8px 10px;font-size:13px;font-weight:600;">${escape(g.kunde)}</td>
        <td style="padding:8px 10px;font-size:12px;color:#5a5955;">${escape(g.projekt)}</td>
        <td style="padding:8px 10px;font-size:12px;color:#5a5955;">${escape(g.text)}</td>
        <td style="padding:8px 10px;font-size:13px;text-align:right;color:#b26b00;font-weight:700;">${g.rest} akt. Lauftage</td>
        <td style="padding:8px 10px;font-size:11px;color:#5a5955;">P1: ${escape(g.phase1 || '—')} · P2: ${escape(g.phase2 || '—')}</td>
      </tr>`).join('');
    html += `<h2 style="margin:22px 0 6px;font-size:16px;color:#0a0a0a;">🛡️ Garantie läuft aus — Einstellungen erfasst?</h2>
      <table style="width:100%;border-collapse:collapse;"><thead><tr style="background:#fafaf8;border-bottom:2px solid #ececea;">
        <th style="padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;color:#5a5955;">Kunde</th>
        <th style="padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;color:#5a5955;">Projekt</th>
        <th style="padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;color:#5a5955;">Garantie</th>
        <th style="padding:8px 10px;text-align:right;font-size:11px;text-transform:uppercase;color:#5a5955;">Rest</th>
        <th style="padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;color:#5a5955;">Einstellungen</th>
      </tr></thead><tbody>${rows}</tbody></table>`;
  }
  return html;
}

function renderMail({ rows, neu24hTotal, datumLabel, metaWarnungen = { budgetWarnungen: [], garantieHinweise: [] } }) {
  const anyWarn = rows.some(r => r.warnung);
  const rowsHtml = rows.map(r => `
    <tr style="border-bottom:1px solid #ececea;${r.warnung ? 'background:#fef2f2;' : ''}">
      <td style="padding:8px 10px;font-size:13px;color:#0a0a0a;font-weight:600;">${escape(r.kunde)}</td>
      <td style="padding:8px 10px;font-size:12px;color:#5a5955;">${escape(r.stelle)}</td>
      <td style="padding:8px 10px;font-size:13px;text-align:center;color:${r.neu24h > 0 ? '#166534' : (r.warnung ? '#b91c1c' : '#9a9994')};font-weight:700;">
        ${r.warnung ? '⚠️ ' : ''}${r.neu24h}
      </td>
      <td style="padding:8px 10px;font-size:13px;text-align:center;color:#0a0a0a;">${r.gesamt}</td>
      <td style="padding:8px 10px;font-size:13px;text-align:center;color:#0a0a0a;">${r.qualifiziert}</td>
      <td style="padding:8px 10px;font-size:11px;color:#5a5955;">${escape(r.quellen || '—')}</td>
      <td style="padding:8px 10px;font-size:11px;color:${r.istLive ? '#166534' : '#5a5955'};">
        ${r.istLive ? `🟢 Live${r.tagX != null ? ` · Tag ${r.tagX}/30` : ''}` : '—'}
      </td>
      <td style="padding:8px 10px;font-size:11px;text-align:right;">
        <a href="${escape(r.link)}" style="color:#3b82f6;text-decoration:none;">Öffnen →</a>
      </td>
    </tr>`).join('');

  return `<!doctype html><html><body style="margin:0;padding:20px;background:#f7f6f2;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">
    <div style="max-width:900px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
      <h1 style="margin:0 0 4px;font-size:22px;color:#0a0a0a;">📊 Bewerbungs-Report ${escape(datumLabel)}</h1>
      <p style="margin:0 0 18px;font-size:14px;color:#5a5955;">
        <strong>${neu24hTotal}</strong> neue Bewerbung${neu24hTotal === 1 ? '' : 'en'} in den letzten 24 Stunden.
        ${anyWarn ? ' · ⚠️ Live-Projekte ohne Eingang &gt;48h markiert.' : ''}
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#fafaf8;border-bottom:2px solid #ececea;">
            <th style="padding:10px;text-align:left;font-size:11px;letter-spacing:0.05em;text-transform:uppercase;color:#5a5955;">Kunde</th>
            <th style="padding:10px;text-align:left;font-size:11px;letter-spacing:0.05em;text-transform:uppercase;color:#5a5955;">Stelle</th>
            <th style="padding:10px;text-align:center;font-size:11px;letter-spacing:0.05em;text-transform:uppercase;color:#5a5955;">Neu 24h</th>
            <th style="padding:10px;text-align:center;font-size:11px;letter-spacing:0.05em;text-transform:uppercase;color:#5a5955;">Gesamt</th>
            <th style="padding:10px;text-align:center;font-size:11px;letter-spacing:0.05em;text-transform:uppercase;color:#5a5955;">Qualifiz.</th>
            <th style="padding:10px;text-align:left;font-size:11px;letter-spacing:0.05em;text-transform:uppercase;color:#5a5955;">Quellen</th>
            <th style="padding:10px;text-align:left;font-size:11px;letter-spacing:0.05em;text-transform:uppercase;color:#5a5955;">Status</th>
            <th style="padding:10px;text-align:right;font-size:11px;letter-spacing:0.05em;text-transform:uppercase;color:#5a5955;">Link</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      ${renderMetaSektionen(metaWarnungen)}
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
    console.warn(`[daily-bewerbungs-report] Resend ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.ok;
}

export async function runDailyBewerbungsReport() {
  if (running) return { skipped: true };
  running = true;
  const t0 = Date.now();
  try {
    const { rows, neu24hTotal } = await collectRows();
    let metaWarnungen = { budgetWarnungen: [], garantieHinweise: [] };
    try { metaWarnungen = await collectMetaWarnungen(); } catch (e) { console.warn('[daily-bewerbungs-report] meta-warnungen:', e.message); }
    const anyMeta = metaWarnungen.budgetWarnungen.length || metaWarnungen.garantieHinweise.length;
    if (!rows.length && neu24hTotal === 0 && !anyMeta) {
      lastResult = { checked: 0, sent: false, reason: 'no_data', duration_ms: Date.now() - t0 };
      lastRunAt = new Date().toISOString();
      console.log('[daily-bewerbungs-report] Nichts los — Mail übersprungen.');
      return lastResult;
    }
    const datumLabel = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const html = renderMail({ rows, neu24hTotal, datumLabel, metaWarnungen });
    const budgetN = metaWarnungen.budgetWarnungen.length, garantieN = metaWarnungen.garantieHinweise.length;
    const subject = `📊 Bewerbungs-Report ${datumLabel}: ${neu24hTotal} neue Bewerbung${neu24hTotal === 1 ? '' : 'en'}`
      + (budgetN ? ` · ${budgetN} Budget⚠️` : '') + (garantieN ? ` · ${garantieN} Garantie🛡️` : '');
    const sent = await sendMail({ subject, html });
    lastResult = { checked: rows.length, sent: !!sent, neu24h: neu24hTotal, duration_ms: Date.now() - t0 };
    lastRunAt = new Date().toISOString();
    console.log(`[daily-bewerbungs-report] ${rows.length} Zeilen, ${neu24hTotal} neu24h — ${sent ? 'gesendet' : 'Fehler'}`);
    return lastResult;
  } finally { running = false; }
}

export function getDailyBewerbungsReportStatus() {
  return { running, last_run_at: lastRunAt, last_result: lastResult };
}

/** Scheduler: stuendlich pruefen, nur um 07:00 Berlin ausloesen. */
export function startDailyBewerbungsReportScheduler() {
  const CHECK_MS = 60 * 60 * 1000;
  const INIT_MS  = 260 * 1000;
  const check = () => {
    const now = new Date();
    const berlinHour = Number(now.toLocaleString('de-DE', { hour: '2-digit', hour12: false, timeZone: 'Europe/Berlin' }));
    if (berlinHour !== 7) return;
    runDailyBewerbungsReport().catch(err => console.error('[daily-bewerbungs-report]', err.message));
  };
  setTimeout(() => { check(); setInterval(check, CHECK_MS); }, INIT_MS);
  console.log('[daily-bewerbungs-report] Scheduler aktiv (täglich 07:00 Berlin).');
}
