// Einmal-Import der Altsystem-Historie (Lexoffice 2021–2023) in die
// Bestandskunden-Tabellen. Idempotent: Kunden werden per (kundennummer, firma)
// upsertet (nur Stammdaten — Reaktivierung/Close-Felder bleiben unberührt),
// die lexoffice_alt-Rechnungen werden vor dem Insert komplett neu gesetzt.
//
//   node scripts/import/import-altsystem.mjs
//
// Ab 17.08.2023 liefert der easybill-Sync die Daten selbst — hier NUR Altsystem.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { supabase } from '../../supabase.js';

if (!supabase) { console.error('Supabase nicht konfiguriert (SUPABASE_URL / SERVICE_ROLE_KEY).'); process.exit(1); }
const HERE = dirname(fileURLToPath(import.meta.url));

/* ── Encoding-Reparatur (Datei ist doppelt-verkodetes UTF-8) ── */
function repairText(s) {
  if (s == null) return s;
  let t = String(s).replace(/^﻿/, '');
  t = t.replace(/&amp;?/g, '&');                         // HTML-Entity
  t = t.replace(/Â­/g, '').replace(/­/g, ''); // Soft-Hyphen
  t = t.replace(/â€™/g, '’').replace(/â€“|â€”/g, '–');   // Dash/Apostroph
  t = t.replace(/uÌ/g, 'ü').replace(/aÌ/g, 'ä').replace(/oÌ/g, 'ö'); // kombin. Diaerese
  const map = {
    'Ã¼': 'ü', 'Ã¤': 'ä', 'Ã¶': 'ö', 'ÃŸ': 'ß', 'Ã©': 'é', 'Ã¨': 'è', 'Ã¡': 'á',
    'Ã„': 'Ä', 'Ã–': 'Ö', 'Ãœ': 'Ü', 'Â®': '®', 'Â¨': '®',
  };
  for (const [k, v] of Object.entries(map)) t = t.split(k).join(v);
  t = t.replace(/GEBÃUDEAUSRÃSTUNG/g, 'GEBÄUDEAUSRÜSTUNG').replace(/HÃPTNER/g, 'HÖPTNER');
  t = t.replace(/\s?â\s?/g, ' – ');                      // verbliebener Dash
  t = t.replace(/Ã(?=[a-zA-Z ]|$)/g, 'ß');               // Byte-verlorenes ß
  t = t.replace(/Â/g, '');
  return t.replace(/\s+/g, ' ').trim();
}

function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim().length);
  const header = lines.shift().split(';').map(h => h.trim());
  return lines.map(line => {
    const cols = line.split(';');
    const row = {};
    header.forEach((h, i) => { row[h] = (cols[i] ?? '').trim(); });
    return row;
  });
}

function normFirma(s) {
  return repairText(s).toLowerCase()
    .replace(/[äöü]/g, m => ({ ä: 'ae', ö: 'oe', ü: 'ue' }[m])).replace(/ß/g, 'ss')
    .replace(/\b(gmbh|mbh|co\.?\s?kg|kg|ug|ag|e\.?\s?k\.?|haftungsbeschraenkt|gbr|ohg|e\.?\s?v\.?|ltd|inh\.?)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

async function importKunden() {
  const rows = parseCsv(readFileSync(join(HERE, 'import_bestandskunden.csv'), 'utf8'));
  const payload = rows.map(r => ({
    kundennummer: r.kundennummer,
    firma: repairText(r.firma),
    fruehere_bezeichnung: r.fruehere_bezeichnung ? repairText(r.fruehere_bezeichnung) : null,
    plz: r.plz || null,
    ort: r.ort ? repairText(r.ort) : null,
    ansprechpartner: r.ansprechpartner ? repairText(r.ansprechpartner) : null,
    quelle: r.quelle || null,
    updated_at: new Date().toISOString(),
  })).filter(r => r.kundennummer && r.firma);

  // Chunked upsert (nur Stammdaten → Reaktivierung/Close-Felder bleiben erhalten).
  let up = 0;
  for (let i = 0; i < payload.length; i += 200) {
    const chunk = payload.slice(i, i + 200);
    const { error } = await supabase.from('talentone_bk_kunden')
      .upsert(chunk, { onConflict: 'kundennummer,firma' });
    if (error) throw new Error(`Kunden-Upsert: ${error.message}`);
    up += chunk.length;
  }
  console.log(`✓ Kunden: ${up} upsertet (aus ${rows.length} CSV-Zeilen).`);
}

async function importRechnungen() {
  const rows = parseCsv(readFileSync(join(HERE, 'import_rechnungen_altsystem.csv'), 'utf8'));

  // Kunden-Index: kundennummer → [{id, firma}]
  const { data: kunden, error: kErr } = await supabase.from('talentone_bk_kunden')
    .select('id, kundennummer, firma');
  if (kErr) throw new Error(`Kunden laden: ${kErr.message}`);
  const byNr = new Map();
  for (const k of kunden || []) {
    if (!byNr.has(k.kundennummer)) byNr.set(k.kundennummer, []);
    byNr.get(k.kundennummer).push(k);
  }

  function findKunde(nr, firmaRaw) {
    const firma = repairText(firmaRaw);
    const cands = byNr.get(nr) || [];
    if (cands.length === 1) return cands[0];              // eindeutige Kundennummer → firma egal (Umbenennungen)
    if (cands.length > 1) {                               // 10268 / 10397: nach firma disambiguieren
      const exact = cands.find(c => c.firma === firma);
      if (exact) return exact;
      const nf = normFirma(firma);
      const fuzzy = cands.find(c => normFirma(c.firma) === nf);
      if (fuzzy) return fuzzy;
      return cands[0];
    }
    return null;
  }

  // Idempotenz: alle Altsystem-Rechnungen weg, dann frisch einsetzen.
  const { error: delErr } = await supabase.from('talentone_bk_rechnungen')
    .delete().eq('quelle', 'lexoffice_alt');
  if (delErr) throw new Error(`Alt-Rechnungen löschen: ${delErr.message}`);

  const inserts = [];
  let unmatched = 0;
  for (const r of rows) {
    let kunde = findKunde(r.kundennummer, r.firma);
    if (!kunde) {
      // Defensiv: fehlenden Kunden anlegen, damit keine Rechnung verloren geht.
      const firma = repairText(r.firma) || `Kunde ${r.kundennummer}`;
      const { data: neu, error } = await supabase.from('talentone_bk_kunden')
        .upsert({ kundennummer: r.kundennummer, firma, quelle: 'lexoffice_alt', updated_at: new Date().toISOString() },
                { onConflict: 'kundennummer,firma' }).select('id, kundennummer, firma').single();
      if (error) { unmatched++; continue; }
      byNr.set(r.kundennummer, [...(byNr.get(r.kundennummer) || []), neu]);
      kunde = neu;
    }
    inserts.push({
      bk_kunde_id: kunde.id,
      datum: r.datum,
      art: 'INVOICE',                                      // Altsystem liefert nur INVOICE (Stornos negativ)
      netto: r.netto === '' ? null : Number(r.netto),
      brutto: r.brutto === '' ? null : Number(r.brutto),
      quelle: 'lexoffice_alt',
    });
  }

  let ins = 0;
  for (let i = 0; i < inserts.length; i += 300) {
    const chunk = inserts.slice(i, i + 300);
    const { error } = await supabase.from('talentone_bk_rechnungen').insert(chunk);
    if (error) throw new Error(`Rechnungen-Insert: ${error.message}`);
    ins += chunk.length;
  }
  console.log(`✓ Rechnungen: ${ins} eingespielt (aus ${rows.length} CSV-Zeilen, ${unmatched} ohne Kunde).`);
}

await importKunden();
await importRechnungen();
console.log('IMPORT FERTIG.');
process.exit(0);
