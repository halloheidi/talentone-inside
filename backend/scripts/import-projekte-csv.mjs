// Import CSV "Projekte-Rasteransicht" → talentone_projekte
// Usage: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node import-projekte-csv.mjs <path-to-csv>

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const csvPath = process.argv[2];
if (!csvPath) { console.error('Usage: node import-projekte-csv.mjs <csv>'); process.exit(1); }

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// ─── RFC4180-ish CSV-Parser (komma, doppelte Quotes, mehrzeilige Felder) ───
function parseCsv(content) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (inQuotes) {
      if (c === '"') {
        if (content[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && content[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const STATUS_MAP = {
  'Abgeschlossen': 'abgeschlossen',
  'Pausiert': 'pausiert',
  'Hold': 'hold',
  'Warte auf Go!': 'warte_auf_go',
  'Live': 'live',
  'Onboarding abgeschlossen vereinbart': 'onboarding',
  'Go-Live vereinbart': 'golive_vereinbart',
  'Kick-Off vereinbart': 'kickoff_vereinbart',
  'Kunde ohne Kick-Off': 'vorbereitung',
  'Homepage/Karriereseite': 'vorbereitung',
};

const HEADER_TO_FIELD = {
  'Projekt': 'projekt',
  'Kunde': 'kunde',
  'Closer': 'closer',
  'Projektart': 'projektart',
  'Projektdauer': 'projektdauer',
  'Status': 'status',
  'Deadline Vorbereitung': 'deadline_vorbereitung',
  'Gesuchte Positionen': 'gesuchte_positionen',
  'Standorte': 'standorte',
  'Start Phase 1': 'start_phase1',
  'Ende Phase 1': 'ende_phase1',
  'Phase 1 Anzahl Einstellungen': 'phase1_einstellungen',
  'Start Phase 2': 'start_phase2',
  'Ende Phase 2': 'ende_phase2',
  'Phase 2 Anzahl Einstellungen': 'phase2_einstellungen',
  'Aktuelle Zufriedenheit': 'zufriedenheit',
  'Startdatum Abo': 'startdatum_abo',
  'Enddatum Abo': 'enddatum_abo',
  'Pausiert seit': 'pausiert_seit',
  'Ziel erreicht Abo': 'ziel_erreicht',
  'RE bezahlt?': 're_bezahlt',
  'RE 2 bezahlt?': 're2_bezahlt',
  'Bewertet?': 'bewertet',
  'Notizen': 'notizen',
  'Projektnummer': 'projektnummer',
  'Pixel': 'pixel',
  'Ready for Upsell': 'ready_for_upsell',
  'Wer sollte den Upsell machen?': 'upsell_wer',
  'Position im Unternehmen': 'position_im_unternehmen',
  'Persönlichkeitstyp': 'persoenlichkeitstyp',
  'E-Mail Adresse': 'email',
  'Verantw.': 'verantwortlich',
  'Fotograf': 'fotograf',
  'Letzter Kontakt': 'letzter_kontakt',
  'Kontaktstatus': 'kontaktstatus',
  'Werbekosten': 'werbekosten',
  'LEAD ID aus Close': 'close_lead_id',
};

// Checkliste-Header (Trim, Lowercase-Substring-Match)
const CHECK_HEADERS = [
  { match: 'facebook zugang',          key: 'fb_zugang' },
  { match: 'formular verschickt',      key: 'formular_verschickt' },
  { match: 'fotograf organisiert',     key: 'fotograf_organisiert' },
  { match: 'fotos erhalten',           key: 'fotos_erhalten' },
  { match: 'fotos fertig',             key: 'fotos_fertig' },
  { match: 'formular erhalten',        key: 'formular_erhalten' },
  { match: 'onboarding formular',      key: 'onboarding_formular' },
  { match: 'creatives erstellt',       key: 'creatives_erstellt' },
  { match: 'ad copies',                key: 'adcopies_geschrieben' },
  { match: 'url bestellt',             key: 'url_bestellt' },
  { match: 'url connected',            key: 'url_connected' },
  { match: 'url verifiziert',          key: 'url_verifiziert_fb' },
  { match: 'events gesetzt',           key: 'events_gesetzt' },
  { match: 'bewerberliste erstellt',   key: 'bewerberliste_erstellt' },
  { match: 'zapier eingerichtet',      key: 'zapier_eingerichtet' },
  { match: 'entwürfe',                 key: 'entwuerfe_verschickt' },
  { match: 'go vom kunden',            key: 'go_vom_kunden' },
  { match: 'avv unterzeichnet',        key: 'avv_unterzeichnet' },
  { match: 'adresse im werbekonto',    key: 'adresse_werbekonto' },
  { match: 'geschenk verschickt',      key: 'geschenk_verschickt' },
  { match: 'testi vereinbaren',        key: 'testi_vereinbaren' },
];

function parseDate(v) {
  if (!v) return null;
  const s = v.trim();
  if (!s) return null;
  // Format Airtable export: "DD.MM.YYYY" oder "YYYY-MM-DD"
  const dot = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (dot) return `${dot[3]}-${dot[2].padStart(2,'0')}-${dot[1].padStart(2,'0')}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  return null;
}
function parseBool(v) {
  if (!v) return false;
  const s = String(v).trim().toLowerCase();
  return s === 'checked' || s === 'true' || s === 'ja' || s === 'yes' || s === '1' || s === '✓' || s === 'x';
}
function parseInteger(v) {
  if (!v) return null;
  const n = parseInt(String(v).replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}
function cleanText(v) {
  const s = (v ?? '').trim();
  return s || null;
}

// ─── Main ───
const raw = readFileSync(csvPath, 'utf8').replace(/^﻿/, '');
const rows = parseCsv(raw);
const headers = rows[0].map(h => h.trim());
const headerIdx = {};
headers.forEach((h, i) => { headerIdx[h] = i; });

const checkColIdx = {};
headers.forEach((h, i) => {
  const lower = h.toLowerCase();
  for (const { match, key } of CHECK_HEADERS) {
    if (lower.includes(match) && !(key in checkColIdx)) checkColIdx[key] = i;
  }
});

console.log(`CSV-Header: ${headers.length} Spalten · ${rows.length - 1} Datenzeilen`);
console.log('Checklist-Mappings:', Object.keys(checkColIdx).length, 'von', CHECK_HEADERS.length);

const records = [];
for (let r = 1; r < rows.length; r++) {
  const row = rows[r];
  // Skip empty rows
  if (row.every(v => !v || !v.trim())) continue;

  const get = (header) => {
    const idx = headerIdx[header];
    if (idx === undefined) return '';
    return row[idx] ?? '';
  };

  const projektName = cleanText(get('Projekt'));
  const kunde = cleanText(get('Kunde'));
  if (!projektName && !kunde) continue;

  const rec = {};
  for (const [header, field] of Object.entries(HEADER_TO_FIELD)) {
    rec[field] = cleanText(get(header));
  }

  // Type conversions
  rec.deadline_vorbereitung = parseDate(rec.deadline_vorbereitung);
  rec.start_phase1 = parseDate(rec.start_phase1);
  rec.ende_phase1 = parseDate(rec.ende_phase1);
  rec.start_phase2 = parseDate(rec.start_phase2);
  rec.ende_phase2 = parseDate(rec.ende_phase2);
  rec.startdatum_abo = parseDate(rec.startdatum_abo);
  rec.enddatum_abo = parseDate(rec.enddatum_abo);
  rec.pausiert_seit = parseDate(rec.pausiert_seit);
  rec.letzter_kontakt = parseDate(rec.letzter_kontakt);
  rec.zufriedenheit = parseInteger(rec.zufriedenheit);
  rec.projektnummer = parseInteger(rec.projektnummer);
  rec.ziel_erreicht  = parseBool(rec.ziel_erreicht);
  rec.re_bezahlt     = parseBool(rec.re_bezahlt);
  rec.re2_bezahlt    = parseBool(rec.re2_bezahlt);
  rec.bewertet       = parseBool(rec.bewertet);
  rec.ready_for_upsell = parseBool(rec.ready_for_upsell);

  // Status mapping
  const statusRaw = rec.status || '';
  rec.status = STATUS_MAP[statusRaw] || 'vorbereitung';

  // Checkliste
  const checkliste = {};
  for (const { key } of CHECK_HEADERS) {
    const idx = checkColIdx[key];
    checkliste[key] = idx !== undefined ? parseBool(row[idx]) : false;
  }
  rec.checkliste = checkliste;

  records.push(rec);
}

console.log(`Bereit zum Insert: ${records.length} Projekte`);

// Batch insert in Blöcken von 50
const BATCH = 50;
let imported = 0;
for (let i = 0; i < records.length; i += BATCH) {
  const slice = records.slice(i, i + BATCH);
  const { error } = await supabase.from('talentone_projekte').insert(slice);
  if (error) {
    console.error(`Batch ${i}-${i + slice.length}:`, error.message);
    process.exit(1);
  }
  imported += slice.length;
  process.stdout.write(`\r${imported}/${records.length}`);
}
console.log(`\n✓ ${imported} Projekte importiert.`);
