// SSL-Selbstcheck: prüft täglich die ausgelieferten Zertifikate der eigenen Domains
// (Restlaufzeit + CN/SAN-Match) und schreibt das Ergebnis nach talentone_settings
// ('ssl_watchdog'). Das Heute-Dashboard liest es und meldet bei Problem unter „Kritisch".
// Hintergrund: am 17.10.2026 kaperte ein Host-nginx 80/443 → falsches Cert, stumm.

import tls from 'node:tls';
import { supabase } from './supabase.js';

// Nur die Primär-Domain des Inside-Tools (recruiting.nowagwirth.com ist ein Alias,
// der das inside-Cert mitnutzt → würde sonst dauerhaft falsch alarmieren).
const DOMAINS = ['inside.talent-one.de'];
const WARN_TAGE = 14;

function pruefeZertifikat(host, port = 443) {
  return new Promise((resolve) => {
    let done = false;
    const fertig = (v) => { if (!done) { done = true; try { socket.destroy(); } catch {} resolve(v); } };
    const socket = tls.connect({ host, port, servername: host, timeout: 8000, rejectUnauthorized: false }, () => {
      const cert = socket.getPeerCertificate();
      if (!cert || !cert.valid_to) return fertig({ host, erreichbar: false });
      const days = Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86400000);
      const cn = cert.subject?.CN || '';
      const san = String(cert.subjectaltname || '').split(',').map(s => s.replace(/^\s*DNS:/i, '').trim());
      const cn_ok = cn === host || san.includes(host);
      fertig({ host, erreichbar: true, cn, cn_ok, days_left: days, valid_to: cert.valid_to });
    });
    socket.on('error', () => fertig({ host, erreichbar: false }));
    socket.on('timeout', () => fertig({ host, erreichbar: false }));
  });
}

/** Bewertet einen Domain-Check → { problem:boolean, grund } */
function bewerte(r) {
  if (!r.erreichbar) return { problem: true, grund: 'nicht erreichbar / kein TLS' };
  if (!r.cn_ok) return { problem: true, grund: `CN-Mismatch (Zertifikat: ${r.cn || '?'})` };
  if (r.days_left < WARN_TAGE) return { problem: true, grund: `läuft in ${r.days_left} Tagen ab` };
  return { problem: false, grund: null };
}

export async function runSslWatchdog() {
  const ergebnisse = [];
  for (const d of DOMAINS) {
    const r = await pruefeZertifikat(d);
    ergebnisse.push({ ...r, ...bewerte(r) });
  }
  const payload = { checked_at: new Date().toISOString(), domains: ergebnisse };
  try {
    await supabase.from('talentone_settings').upsert(
      { schluessel: 'ssl_watchdog', wert: JSON.stringify(payload), updated_at: new Date().toISOString(), updated_by: 'ssl-watchdog' },
      { onConflict: 'schluessel' });
  } catch (e) { console.warn('[ssl-watchdog] persist:', e.message); }
  const probleme = ergebnisse.filter(r => r.problem);
  console.log(`[ssl-watchdog] ${DOMAINS.length} geprüft, ${probleme.length} Problem(e)${probleme.length ? ': ' + probleme.map(p => `${p.host} (${p.grund})`).join(', ') : ''}`);
  return payload;
}

/** Fürs Dashboard: gespeicherten Stand lesen → [{host, grund}] mit Problem. */
export async function sslProbleme() {
  try {
    const { data } = await supabase.from('talentone_settings').select('wert').eq('schluessel', 'ssl_watchdog').maybeSingle();
    if (!data?.wert) return [];
    const p = JSON.parse(data.wert);
    return (p.domains || []).filter(d => d.problem).map(d => ({ host: d.host, grund: d.grund, checked_at: p.checked_at }));
  } catch { return []; }
}

export function startSslWatchdogScheduler() {
  setTimeout(() => runSslWatchdog().catch(e => console.warn('[ssl-watchdog]', e.message)), 30 * 1000);
  setInterval(() => runSslWatchdog().catch(e => console.warn('[ssl-watchdog]', e.message)), 24 * 60 * 60 * 1000);
}
