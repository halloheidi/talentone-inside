// Verbindet Bewerbung <-> Google Sheet. Wird best-effort im Webhook-Flow und bei
// der Vorqual-Rueckschreibung aufgerufen. Fehler blockieren NIE die normale
// Verarbeitung — nur Log + (bei wiederholtem Scheitern) interne Warn-Mail.

import { supabase } from './supabase.js';
import { isConfigured, readHeaderRow, appendRow, updateCells, firstSheetName } from './google-sheets.js';
import { buildAppendRow, buildVorqualUpdateCells, toPairs, extractStelle } from './sheets-mapping.js';

let _consecutiveFailures = 0;

// Berlin-Zeit "YYYY-MM-DD HH:MM:SS" (Format wie im Bestand des Sheets).
function berlinTimestamp(iso) {
  const d = iso ? new Date(iso) : new Date();
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d).reduce((o, p) => (o[p.type] = p.value, o), {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function cfgOf(kunde) {
  const c = kunde?.sheets_sync;
  if (!c || !c.enabled || !c.spreadsheet_id) return null;
  if (!isConfigured()) return null; // GOOGLE_SERVICE_ACCOUNT_JSON fehlt -> stiller No-Op
  return { spreadsheetId: c.spreadsheet_id, sheetName: c.sheet_name || '' };
}

function cfgSheetUrl(kunde) {
  const id = kunde?.sheets_sync?.spreadsheet_id;
  return id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : undefined;
}

async function resolveSheetName(cfg) {
  if (cfg.sheetName) return cfg.sheetName;
  // Leer -> erstes Tabellenblatt (einmal aufloesen, guenstig genug).
  return (await firstSheetName(cfg.spreadsheetId)) || '';
}

async function warnBeiWiederholung(kunde, job, fehler) {
  _consecutiveFailures++;
  console.warn(`[sheets-sync] Fehlversuch #${_consecutiveFailures}: ${fehler}`);
  if (_consecutiveFailures === 3) {
    try {
      const { sendTeamAlertMail } = await import('./mail.js');
      await sendTeamAlertMail({
        subject: 'Google-Sheets-Sync scheitert wiederholt',
        headline: 'Google-Sheets-Sync scheitert wiederholt',
        lead: `Der Sheets-Sync ist ${_consecutiveFailures}× in Folge fehlgeschlagen. Kunde: ${kunde?.firmenname || kunde?.id}${job?.stelle ? ', Stelle: ' + job.stelle : ''}. Letzter Fehler: ${fehler}. Bewerbungen werden normal gespeichert — nur das Sheet ist betroffen.`,
        linkUrl: cfgSheetUrl(kunde),
        linkLabel: 'Zum Sheet',
      });
    } catch (e) { console.warn('[sheets-sync] Warn-Mail fehlgeschlagen:', e.message); }
  }
}

/**
 * Neue Bewerbung ans Sheet anhaengen (append-only). Idempotent ueber
 * sheets_synced_at. Blockiert nie — wirft nicht nach aussen.
 */
export async function syncBewerbungToSheet({ bewerbung, job, kunde }) {
  const cfg = cfgOf(kunde);
  if (!cfg) return;
  if (bewerbung?.sheets_synced_at) return; // schon geschrieben (Retry-Schutz)

  try {
    const sheetName = await resolveSheetName(cfg);
    const header = await readHeaderRow(cfg.spreadsheetId, sheetName);
    if (!header.length) throw new Error('Kopfzeile leer/nicht lesbar.');

    const pairs = toPairs({ antworten: bewerbung.antworten, vorqual: bewerbung.vorqualifizierung_werte });
    const ctx = {
      name: bewerbung.name || '',
      email: bewerbung.email || '',
      telefon: bewerbung.telefon || '',
      datum: berlinTimestamp(bewerbung.created_at),
      // Stelle kommt aus der Formular-Antwort (nicht aus der Job-Zuordnung).
      // Keine Antwort -> leer lassen, Kunde traegt nach (nicht raten).
      stelle: bewerbung.stelle_gewaehlt || extractStelle(bewerbung.antworten) || '',
      quelle: bewerbung.quelle || '',
    };
    const { row } = buildAppendRow({ header, ctx, pairs });
    const rowNumber = await appendRow(cfg.spreadsheetId, sheetName, row);

    await supabase.from('talentone_bewerbungen')
      .update({ sheets_synced_at: new Date().toISOString(), sheets_row_number: rowNumber })
      .eq('id', bewerbung.id);

    _consecutiveFailures = 0;
    console.log(`[sheets-sync] Bewerbung ${bewerbung.id.slice(0, 8)} -> Sheet-Zeile ${rowNumber}`);
  } catch (err) {
    await warnBeiWiederholung(kunde, job, err.message);
  }
}

/**
 * Vorqual-Daten in die BESTEHENDE Sheet-Zeile zurueckschreiben (nur N&W-Spalten).
 * Braucht die gespeicherte Zeilennummer; ohne diese kein Update (kein Raten).
 */
export async function updateVorqualInSheet({ bewerbung, kunde, vorqualWerte, nwKontaktiertAm }) {
  const cfg = cfgOf(kunde);
  if (!cfg) return;
  if (!bewerbung?.sheets_row_number) return; // keine Zeile bekannt -> nichts tun

  try {
    const sheetName = await resolveSheetName(cfg);
    const header = await readHeaderRow(cfg.spreadsheetId, sheetName);
    if (!header.length) throw new Error('Kopfzeile leer/nicht lesbar.');
    const cells = buildVorqualUpdateCells({ header, vorqual: vorqualWerte || {}, nwKontaktiertAm });
    if (!cells.length) return;
    await updateCells(cfg.spreadsheetId, sheetName, bewerbung.sheets_row_number, cells);
    _consecutiveFailures = 0;
    console.log(`[sheets-sync] Vorqual -> Sheet-Zeile ${bewerbung.sheets_row_number} (${cells.length} Zellen)`);
  } catch (err) {
    await warnBeiWiederholung(kunde, null, err.message);
  }
}
