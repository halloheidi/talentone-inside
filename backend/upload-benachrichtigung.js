// Sammel-Benachrichtigung für Kunden-Uploads (Logo/Fotos über den Upload-Link).
//
// Problem: Kunden laden oft mehrere Dateien nacheinander hoch. Die Upload-Strecke
// (PublicUpload) hat keinen expliziten "Fertig"-Schritt — der Kunde schließt
// einfach den Tab. Deshalb bündeln wir per Debounce: jeder Upload aktualisiert
// talentone_upload_benachrichtigung (via SQL-Funktion vermerke_upload, atomar),
// und ein Cron sendet EINE gebündelte Team-Mail, sobald 30 Minuten kein weiterer
// Upload desselben Kunden mehr kam.
//
// DB-gestützt statt In-Memory-Timer, damit ein Container-Neustart die noch
// nicht gemeldeten Sammlungen nicht verliert.

import { supabase } from './supabase.js';
import { sendTeamAlertMail } from './mail.js';

const INSIDE_BASE = process.env.INSIDE_BASE_URL || 'https://inside.talent-one.de';
const DEBOUNCE_MIN = 30;

let running = false;
let lastRunAt = null;
let lastResult = null;

// ── Einen Upload vermerken (aus der Public-Upload-Route, beide Zweige) ──
export async function vermerkeUpload(kundeId, { typ, dateiname } = {}) {
  if (!kundeId) return;
  try {
    await supabase.rpc('vermerke_upload', {
      p_kunde_id: kundeId,
      p_typ: typ === 'logo' ? 'logo' : 'foto',
      p_dateiname: (dateiname || 'datei').toString().slice(0, 180),
    });
  } catch (err) {
    console.warn('[upload-benachr] vermerkeUpload:', err.message);
  }
}

// ── Erledigt-Verzahnung: offene Foto-/Logo-Anfrage als beantwortet markieren, ──
//    sobald der geforderte Umfang durch die Uploads erfüllt ist. So mahnt die
//    Überfälligkeits-Logik nicht weiter, obwohl der Kunde geliefert hat.
export async function markAnfrageBeantwortetWennErfuellt(kundeId) {
  if (!kundeId) return;
  try {
    const { data: kunde } = await supabase.from('talentone_kunden')
      .select('id, logo_url').eq('id', kundeId).maybeSingle();
    if (!kunde) return;

    const { data: kundeJobs } = await supabase.from('talentone_jobs')
      .select('id').eq('kunde_id', kundeId);
    const jobIds = (kundeJobs || []).map(j => j.id);
    if (!jobIds.length) return;

    const { data: anfrage } = await supabase.from('talentone_versand')
      .select('id, inhalte').in('job_id', jobIds).eq('typ', 'anfrage')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!anfrage || anfrage.inhalte?.beantwortet_am) return; // keine offene Anfrage

    const umfang = anfrage.inhalte?.umfang || 'beides';
    const wantLogo = umfang !== 'fotos';
    const wantFotos = umfang !== 'logo';

    const { data: refbilder } = await supabase.from('talentone_referenzbilder')
      .select('typ').eq('kunde_id', kundeId);
    const hatFotos = (refbilder || []).some(r => r.typ !== 'logo');
    const hatLogo = !!kunde.logo_url;

    const erfuellt = (!wantLogo || hatLogo) && (!wantFotos || hatFotos);
    if (!erfuellt) return; // Umfang noch nicht komplett — Anfrage bleibt offen

    await supabase.from('talentone_versand')
      .update({ inhalte: { ...(anfrage.inhalte || {}), beantwortet_am: new Date().toISOString() } })
      .eq('id', anfrage.id);
  } catch (err) {
    console.warn('[upload-benachr] markAnfrageBeantwortet:', err.message);
  }
}

// ── Cron: gebündelte Mails für "fertige" Sammlungen versenden ──
async function runUploadBenachrichtigungRound() {
  if (running) return lastResult;
  running = true;
  try {
    const cutoff = new Date(Date.now() - DEBOUNCE_MIN * 60 * 1000).toISOString();
    const { data: faellig } = await supabase.from('talentone_upload_benachrichtigung')
      .select('kunde_id, letzter_upload_at, dateien')
      .is('gemeldet_at', null)
      .lt('letzter_upload_at', cutoff);

    let sent = 0;
    for (const row of (faellig || [])) {
      try {
        const dateien = Array.isArray(row.dateien) ? row.dateien : [];
        if (!dateien.length) { // nichts zu melden — trotzdem als gemeldet markieren
          await supabase.from('talentone_upload_benachrichtigung')
            .update({ gemeldet_at: new Date().toISOString() }).eq('kunde_id', row.kunde_id);
          continue;
        }
        const { data: kunde } = await supabase.from('talentone_kunden')
          .select('id, firmenname').eq('id', row.kunde_id).maybeSingle();
        const firmenname = kunde?.firmenname || 'Kunde';

        const fotos = dateien.filter(d => d.typ !== 'logo');
        const hatLogo = dateien.some(d => d.typ === 'logo');
        const anzahl = dateien.length;

        const teile = [];
        if (fotos.length) teile.push(`${fotos.length} Foto${fotos.length === 1 ? '' : 's'}`);
        teile.push(hatLogo ? 'Logo ja' : 'Logo nein');
        const artZeile = teile.join(' · ');

        const namen = dateien.map(d => `• ${d.dateiname || 'datei'}${d.typ === 'logo' ? ' (Logo)' : ''}`).join('\n');
        const lead = `${firmenname} hat Dateien über den Upload-Link hochgeladen.\n\n${artZeile}\n\nDateien:\n${namen}`;

        await sendTeamAlertMail({
          subject: `📸 ${firmenname} hat Dateien hochgeladen (${anzahl} Stück)`,
          headline: `${firmenname} hat Dateien hochgeladen`,
          lead,
          linkUrl: `${INSIDE_BASE}/kunden/${row.kunde_id}#referenzbilder`,
          linkLabel: 'Zur Kundenakte (Bilder)',
        });

        await supabase.from('talentone_upload_benachrichtigung')
          .update({ gemeldet_at: new Date().toISOString() }).eq('kunde_id', row.kunde_id);
        sent++;
      } catch (err) {
        console.warn('[upload-benachr] Zeile:', err.message);
      }
    }

    lastRunAt = new Date().toISOString();
    lastResult = { faellig: (faellig || []).length, sent };
    if (sent) console.log(`[upload-benachr] Runde fertig — ${sent} Mail(s) versendet`);
    return lastResult;
  } finally { running = false; }
}

export function getUploadBenachrichtigungStatus() {
  return { running, last_run_at: lastRunAt, last_result: lastResult };
}

// Alle 5 Min prüfen (kein Berlin-Stunden-Gate — ein Debounce muss rund um die
// Uhr ~30 Min nach dem letzten Upload feuern).
export function startUploadBenachrichtigungScheduler() {
  const CHECK_MS = 5 * 60 * 1000;
  const INIT_MS  = 90 * 1000;
  const check = () => runUploadBenachrichtigungRound()
    .catch(err => console.error('[upload-benachr]', err.message));
  setTimeout(() => { check(); setInterval(check, CHECK_MS); }, INIT_MS);
  console.log('[upload-benachr] Scheduler aktiv (alle 5 Min, 30-Min-Debounce).');
}
