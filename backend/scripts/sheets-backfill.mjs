// Backfill: bestehende Tool-Bewerbungen eines Kunden ins Google Sheet nachtragen.
//
// Das Sheet enthaelt kuratierte Kundendaten — deshalb ZUERST Dry-Run: listet nur,
// was ergaenzt WUERDE (Abgleich ueber Name + Beworben-am gegen die vorhandenen
// Zeilen). Nichts wird doppelt geschrieben. Erst mit APPLY=1 wird chronologisch
// angehaengt (aelteste zuerst) und sheets_synced_at + Zeilennummer gesetzt.
//
// Nutzung (auf dem VPS, mit gesetztem GOOGLE_SERVICE_ACCOUNT_JSON + Supabase-Env):
//   docker compose exec backend node scripts/sheets-backfill.mjs <KUNDE_ID>            # Dry-Run
//   docker compose exec backend node scripts/sheets-backfill.mjs <KUNDE_ID> --apply    # schreibt
//
// Default-KUNDE_ID = Clivet.

import { supabase } from '../supabase.js';
import { isConfigured, readHeaderRow, readValues, appendRow, firstSheetName } from '../google-sheets.js';
import { buildAppendRow, toPairs, extractStelle } from '../sheets-mapping.js';

const CLIVET_ID = '18bbfb99-f8b8-4b64-b08e-6fdf6e463cf9';
const kundeId = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : CLIVET_ID;
const APPLY = process.argv.includes('--apply') || process.env.APPLY === '1';

function berlinTimestamp(iso) {
  const d = iso ? new Date(iso) : new Date();
  const p = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d).reduce((o, x) => (o[x.type] = x.value, o), {});
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

// Abgleich-Schluessel: Name (normalisiert) + Beworben-am (nur Datum YYYY-MM-DD).
const normName = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const dayOf = (ts) => String(ts || '').slice(0, 10);
const key = (name, ts) => `${normName(name)}|${dayOf(ts)}`;

// Header-Spalte fuer Name / Beworben-am finden (per Fuzzy wie im Mapping).
function findCol(header, needles) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[.:()\/\-–—]/g, ' ')
    .replace(/[äöü]/g, m => ({ ä: 'ae', ö: 'oe', ü: 'ue' }[m])).replace(/ß/g, 'ss').replace(/\s+/g, ' ').trim();
  return header.findIndex(h => { const n = norm(h); return needles.some(x => n.includes(norm(x))); });
}

async function main() {
  if (!isConfigured()) { console.error('GOOGLE_SERVICE_ACCOUNT_JSON nicht gesetzt — Abbruch.'); process.exit(1); }

  const { data: kunde, error: kErr } = await supabase.from('talentone_kunden')
    .select('id, firmenname, sheets_sync').eq('id', kundeId).maybeSingle();
  if (kErr || !kunde) { console.error('Kunde nicht gefunden:', kundeId, kErr?.message); process.exit(1); }
  const cfg = kunde.sheets_sync;
  if (!cfg?.enabled || !cfg?.spreadsheet_id) { console.error('sheets_sync fuer Kunde nicht aktiv.'); process.exit(1); }

  const sheetName = cfg.sheet_name || (await firstSheetName(cfg.spreadsheet_id)) || '';
  console.log(`\nKunde: ${kunde.firmenname}\nSheet: ${cfg.spreadsheet_id} / "${sheetName || '(erstes Blatt)'}"`);
  console.log(`Modus: ${APPLY ? 'APPLY (schreibt)' : 'DRY-RUN (liest nur)'}\n`);

  const header = await readHeaderRow(cfg.spreadsheet_id, sheetName);
  if (!header.length) { console.error('Kopfzeile leer/nicht lesbar — Abbruch.'); process.exit(1); }

  // Vorhandene Zeilen -> Schluesselmenge (Name + Tag), um Dubletten zu vermeiden.
  const values = await readValues(cfg.spreadsheet_id, sheetName, 'A:Z');
  const nameCol = findCol(header, ['vor und nachname', 'name']);
  const dateCol = findCol(header, ['beworben am', 'eingang', 'datum']);
  const existing = new Set();
  values.slice(1).forEach(r => {
    const n = nameCol >= 0 ? r[nameCol] : '';
    const d = dateCol >= 0 ? r[dateCol] : '';
    if (normName(n)) existing.add(key(n, d));
  });
  console.log(`Kopf: ${header.length} Spalten. Vorhandene Datenzeilen: ${values.length - 1}. Name-Spalte #${nameCol}, Datum-Spalte #${dateCol}.\n`);

  // Alle Bewerbungen des Kunden (ueber alle Stellen), aelteste zuerst.
  const { data: jobs } = await supabase.from('talentone_jobs').select('id, stelle').eq('kunde_id', kundeId);
  const jobById = new Map((jobs || []).map(j => [j.id, j]));
  const { data: bews } = await supabase.from('talentone_bewerbungen')
    .select('id, name, email, telefon, quelle, antworten, vorqualifizierung_werte, created_at, job_id, stelle_gewaehlt, sheets_synced_at, sheets_row_number')
    .in('job_id', (jobs || []).map(j => j.id))
    .order('created_at', { ascending: true });

  const toAdd = [];
  for (const b of (bews || [])) {
    if (b.sheets_synced_at) continue;                       // schon im Sheet (durch uns)
    if (existing.has(key(b.name, berlinTimestamp(b.created_at)))) continue; // schon kuratiert vorhanden
    toAdd.push(b);
  }

  console.log(`Bewerbungen gesamt: ${bews?.length || 0}. Nachzutragen: ${toAdd.length}.\n`);
  toAdd.forEach((b, i) => {
    console.log(`  ${String(i + 1).padStart(3)}. ${berlinTimestamp(b.created_at)}  ${b.name || '(ohne Name)'}  [${jobById.get(b.job_id)?.stelle || b.job_id?.slice(0, 8)}]`);
  });

  if (!APPLY) { console.log('\nDRY-RUN — nichts geschrieben. Mit --apply erneut ausfuehren zum Nachtragen.'); return; }
  if (!toAdd.length) { console.log('\nNichts nachzutragen.'); return; }

  console.log('\n--- APPLY: schreibe chronologisch ---');
  let ok = 0, fail = 0;
  for (const b of toAdd) {
    try {
      const job = jobById.get(b.job_id);
      const pairs = toPairs({ antworten: b.antworten, vorqual: b.vorqualifizierung_werte });
      const ctx = {
        name: b.name || '', email: b.email || '', telefon: b.telefon || '',
        datum: berlinTimestamp(b.created_at),
        stelle: b.stelle_gewaehlt || extractStelle(b.antworten) || '', quelle: b.quelle || '',
      };
      const { row } = buildAppendRow({ header, ctx, pairs });
      const rowNumber = await appendRow(cfg.spreadsheet_id, sheetName, row);
      await supabase.from('talentone_bewerbungen')
        .update({ sheets_synced_at: new Date().toISOString(), sheets_row_number: rowNumber })
        .eq('id', b.id);
      ok++;
      console.log(`  ✓ ${b.name} -> Zeile ${rowNumber}`);
    } catch (e) {
      fail++;
      console.warn(`  ✗ ${b.name}: ${e.message}`);
    }
  }
  console.log(`\nFertig. Geschrieben: ${ok}, Fehler: ${fail}.`);
}

main().catch(e => { console.error('Backfill-Fehler:', e); process.exit(1); });
