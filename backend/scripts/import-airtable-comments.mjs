// Importiert Airtable-Kommentare in talentone_kommentare.
// Match-Kriterium: projektnummer (Airtable field "Projektnummer") → talentone_projekte.projektnummer.
// Fallback: projekt-Name (case-insensitive).

import { createClient } from '@supabase/supabase-js';

const TOKEN  = process.env.AIRTABLE_API_KEY;
const BASE   = process.env.AIRTABLE_BASE_ID  || 'appMuZozdUaUVlMbO';
const TABLE  = process.env.AIRTABLE_TABLE_ID || 'tbldgaJ8yEXhI7iVe';
if (!TOKEN) { console.error('AIRTABLE_API_KEY fehlt'); process.exit(1); }

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function airtable(path) {
  const res = await fetch(`https://api.airtable.com/v0/${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable ${res.status} ${path}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// ── Alle Projekte aus unserer DB für das Matching ──
const { data: projekte, error: pe } = await supabase
  .from('talentone_projekte')
  .select('id, projekt, kunde, projektnummer');
if (pe) { console.error(pe); process.exit(1); }
console.log(`DB: ${projekte.length} Projekte zum Matchen`);

const byNum = new Map();
const byName = new Map();
for (const p of projekte) {
  if (p.projektnummer != null) byNum.set(p.projektnummer, p.id);
  if (p.projekt) byName.set((p.projekt || '').trim().toLowerCase(), p.id);
}

// ── Alle Airtable-Records paginiert ziehen ──
console.log('Lade Airtable-Records …');
let offset = null;
const records = [];
do {
  const q = offset ? `?offset=${encodeURIComponent(offset)}` : '';
  const page = await airtable(`${BASE}/${TABLE}${q}`);
  records.push(...page.records);
  offset = page.offset;
  process.stdout.write(`\r  ${records.length} Records geladen`);
} while (offset);
console.log(`\nAirtable: ${records.length} Records total`);

// ── Kommentar-Import pro Record ──
let totalComments = 0;
let insertedComments = 0;
let unmatched = 0;
const insertBatch = [];

for (let i = 0; i < records.length; i++) {
  const r = records[i];
  const f = r.fields || {};

  // Projekt finden
  let projektId = null;
  const num = f['Projektnummer'];
  if (num != null && byNum.has(parseInt(num, 10))) projektId = byNum.get(parseInt(num, 10));
  if (!projektId && f['Projekt']) {
    projektId = byName.get(String(f['Projekt']).trim().toLowerCase()) || null;
  }
  if (!projektId) { unmatched++; continue; }

  // Kommentare laden — pro Record-API ist gemächlich, deshalb fortlaufend mit kleinem Delay
  try {
    const comm = await airtable(`${BASE}/${TABLE}/${r.id}/comments`);
    const list = comm.comments || [];
    totalComments += list.length;
    for (const c of list) {
      insertBatch.push({
        projekt_id: projektId,
        autor: c.author?.name || c.author?.email || 'Unbekannt',
        text: c.text || '',
        erwaehnungen: c.mentioned ? Object.values(c.mentioned).map(m => m.name || m.email) : [],
        quelle: 'airtable_import',
        airtable_comment_id: c.id,
        created_at: c.createdTime || null,
      });
    }
  } catch (err) {
    console.warn(`Record ${r.id}: ${err.message}`);
  }

  if ((i + 1) % 25 === 0) process.stdout.write(`\r  ${i + 1}/${records.length} Records, ${totalComments} Kommentare gefunden`);
  // 200ms throttle damit Airtable rate-limit nicht zuschlägt
  await new Promise(r => setTimeout(r, 200));
}
console.log(`\nFertig — Kommentare gefunden: ${totalComments}, Records ohne Match: ${unmatched}`);

// ── Bulk-Insert (upsert auf airtable_comment_id damit Re-Runs idempotent sind) ──
if (insertBatch.length) {
  const BATCH = 100;
  for (let i = 0; i < insertBatch.length; i += BATCH) {
    const slice = insertBatch.slice(i, i + BATCH);
    const { error } = await supabase
      .from('talentone_kommentare')
      .upsert(slice, { onConflict: 'airtable_comment_id', ignoreDuplicates: true });
    if (error) { console.error('Insert-Fehler:', error.message); break; }
    insertedComments += slice.length;
    process.stdout.write(`\r  ${insertedComments}/${insertBatch.length} eingefügt`);
  }
}
console.log(`\n✓ ${insertedComments} Kommentare gespeichert.`);
