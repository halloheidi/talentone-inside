// Einmaliger Airtable-Import: Freiflaechen-Pipeline (nur diese eine Tabelle —
// Dachflaechen ist abgeschaltet und wird NICHT importiert).
//
// Ausfuehrung im Backend-Container:
//   docker compose exec -T inside-backend node scripts/airtable-import-freiflaechen.mjs
//
// Env-Variablen:
//   AIRTABLE_API_KEY, AIRTABLE_BASE_ID
//   FREIFLAECHEN_KUNDE_ID   (UUID des internen Kunden, dem die Leads zugeordnet werden)
//                            Wenn leer: das Script sucht/legt "Freiflaechen"-Kunde an.
//   FREIFLAECHEN_TABLE_NAME (default "Freiflächen") — Airtable-Tabellenname

import { supabase } from '../supabase.js';

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE_NAME = process.env.FREIFLAECHEN_TABLE_NAME || 'Freiflächen';
const KUNDE_ID = process.env.FREIFLAECHEN_KUNDE_ID || null;

if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
  console.error('AIRTABLE_API_KEY und AIRTABLE_BASE_ID müssen gesetzt sein.');
  process.exit(1);
}

const AT_BASE = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`;
const AT_META = `https://api.airtable.com/v0/meta/bases/${AIRTABLE_BASE_ID}/tables`;

async function atFetch(url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function fetchSchema() {
  const data = await atFetch(AT_META);
  const table = (data.tables || []).find(t => t.name === TABLE_NAME);
  if (!table) throw new Error(`Tabelle "${TABLE_NAME}" nicht in Base gefunden.`);
  return table;
}

async function fetchAllRecords() {
  const records = [];
  let offset = null;
  do {
    const url = `${AT_BASE}/${encodeURIComponent(TABLE_NAME)}?pageSize=100${offset ? `&offset=${offset}` : ''}`;
    const data = await atFetch(url);
    records.push(...(data.records || []));
    offset = data.offset || null;
  } while (offset);
  return records;
}

async function fetchCommentsForRecord(recordId) {
  try {
    const data = await atFetch(`${AT_BASE}/${encodeURIComponent(TABLE_NAME)}/${recordId}/comments`);
    return data.comments || [];
  } catch (err) {
    // Comments-API ist optional pro Base — nicht abbrechen
    console.warn(`  Kommentare fuer ${recordId}: ${err.message}`);
    return [];
  }
}

function findField(fields, candidates) {
  for (const c of candidates) {
    const k = Object.keys(fields).find(x => x.toLowerCase() === c.toLowerCase());
    if (k && fields[k] != null && fields[k] !== '') return fields[k];
  }
  return null;
}

function extractContact(fields) {
  const eigentuemer = findField(fields, ['Eigentümer', 'Eigentuemer', 'Name', 'Ansprechpartner']);
  const telefon = findField(fields, ['Telefon (Mobil)', 'Telefon', 'Handy', 'Mobil']);
  const email = findField(fields, ['E-Mail', 'Email', 'Mail']);
  return {
    name: typeof eigentuemer === 'string' ? eigentuemer.trim() : (eigentuemer?.name || null),
    telefon: typeof telefon === 'string' ? telefon.trim() : null,
    email: typeof email === 'string' ? email.trim() : null,
  };
}

function extractStatus(fields) {
  const raw = findField(fields, ['Status', 'Pipeline', 'Phase']);
  if (!raw) return 'neu';
  const s = String(raw).toLowerCase().trim();
  // Ableitung: einige haeufige Werte auf unsere IDs mappen (siehe pipelineStufenAusFeld)
  return s.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'neu';
}

function pipelineStufenAusFeld(field) {
  // Airtable "Single Select"-Optionen — als Stufen 1:1 uebernehmen
  const opts = field?.options?.choices || [];
  if (!opts.length) return null;
  const FARB_MAP = {
    grayLight2: '#9ca3af', gray: '#6b7280', blueLight2: '#93c5fd', blue: '#3b82f6',
    yellowLight2: '#fde68a', yellow: '#f59e0b', orange: '#f97316', red: '#dc2626',
    greenLight2: '#86efac', green: '#16a34a', purple: '#8b5cf6', pink: '#ec4899',
    cyan: '#06b6d4',
  };
  return opts.map((o, i) => ({
    id: String(o.name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `stufe_${i + 1}`,
    name: o.name,
    farbe: FARB_MAP[o.color] || '#6b7280',
    reihenfolge: (i + 1) * 10,
  }));
}

async function findOrCreateKunde() {
  if (KUNDE_ID) {
    const { data } = await supabase.from('talentone_kunden').select('*').eq('id', KUNDE_ID).maybeSingle();
    if (!data) throw new Error(`FREIFLAECHEN_KUNDE_ID ${KUNDE_ID} nicht gefunden.`);
    return data;
  }
  const { data: found } = await supabase.from('talentone_kunden').select('*')
    .ilike('firmenname', '%Freifläch%').limit(1).maybeSingle();
  if (found) return found;
  const { data: created, error } = await supabase.from('talentone_kunden').insert({
    firmenname: 'Freiflächen-Pipeline',
    agentur: 'nowagwirth',
    status: 'aktiv',
  }).select().single();
  if (error) throw new Error(`Kunde anlegen: ${error.message}`);
  return created;
}

async function findOrCreateJob(kundeId, pipeline) {
  const { data: found } = await supabase.from('talentone_jobs').select('*')
    .eq('kunde_id', kundeId).eq('projekttyp', 'neukundengewinnung')
    .ilike('stelle', '%Freifläch%').limit(1).maybeSingle();
  if (found) {
    // Pipeline-Stufen updaten falls anders
    if (pipeline?.length && JSON.stringify(found.pipeline_stufen) !== JSON.stringify(pipeline)) {
      await supabase.from('talentone_jobs').update({ pipeline_stufen: pipeline }).eq('id', found.id);
      found.pipeline_stufen = pipeline;
    }
    return found;
  }
  const { data: created, error } = await supabase.from('talentone_jobs').insert({
    kunde_id: kundeId,
    projekttyp: 'neukundengewinnung',
    stelle: 'Freiflächen-Pipeline',
    eingabe_methode: 'airtable_import',
    pipeline_stufen: pipeline,
    neukunden_daten: { produkt: 'Freiflächen', quelle: 'Airtable-Import' },
  }).select().single();
  if (error) throw new Error(`Job anlegen: ${error.message}`);
  return created;
}

async function main() {
  console.log(`[at-import] Base ${AIRTABLE_BASE_ID.slice(0, 10)}… — Tabelle "${TABLE_NAME}"`);
  const schema = await fetchSchema();
  console.log(`[at-import] Schema OK — ${schema.fields.length} Felder`);
  const statusField = schema.fields.find(f => /^(status|pipeline|phase)$/i.test(f.name));
  const pipeline = pipelineStufenAusFeld(statusField) || [
    { id: 'neu', name: 'Neu', farbe: '#6b7280', reihenfolge: 10 },
    { id: 'aktiv', name: 'Aktiv', farbe: '#3b82f6', reihenfolge: 20 },
    { id: 'angebot', name: 'Angebot', farbe: '#f59e0b', reihenfolge: 30 },
    { id: 'gewonnen', name: 'Gewonnen', farbe: '#16a34a', reihenfolge: 40 },
    { id: 'verloren', name: 'Verloren', farbe: '#dc2626', reihenfolge: 50 },
  ];
  console.log(`[at-import] Pipeline (${pipeline.length}): ${pipeline.map(s => s.name).join(' → ')}`);

  const kunde = await findOrCreateKunde();
  const job = await findOrCreateJob(kunde.id, pipeline);
  console.log(`[at-import] Ziel: Kunde "${kunde.firmenname}" (${kunde.id.slice(0, 8)}) · Job ${job.id.slice(0, 8)}`);

  const records = await fetchAllRecords();
  console.log(`[at-import] ${records.length} Records geladen.`);

  let created = 0, skipped = 0, kommentareTotal = 0;
  for (const r of records) {
    const contact = extractContact(r.fields || {});
    const daten = { ...r.fields, _airtable_id: r.id };
    delete daten.Eigentümer; delete daten['Telefon (Mobil)']; delete daten['E-Mail'];
    const status = extractStatus(r.fields || {});
    const notizen = findField(r.fields || {}, ['Anmerkung', 'Notiz', 'Notizen']);
    const createdAt = r.createdTime || null;

    // Dedupe: per _airtable_id im daten-json (falls schon importiert)
    const { data: exists } = await supabase.from('talentone_anfragen')
      .select('id').eq('job_id', job.id).eq('daten->>_airtable_id', r.id).maybeSingle();
    if (exists) { skipped++; continue; }

    const insertRow = {
      job_id: job.id,
      name: contact.name,
      email: contact.email,
      telefon: contact.telefon,
      daten,
      quelle: 'airtable_import',
      status,
      notizen: notizen ? String(notizen) : null,
      created_at: createdAt || undefined,
    };
    const { data: neuer, error } = await supabase.from('talentone_anfragen').insert(insertRow).select().single();
    if (error) { console.warn(`  Skip ${r.id}: ${error.message}`); skipped++; continue; }
    created++;

    // Kommentare
    const comments = await fetchCommentsForRecord(r.id);
    for (const c of comments) {
      await supabase.from('talentone_anfragen_kommentare').insert({
        anfrage_id: neuer.id,
        autor: c.author?.name || 'Airtable',
        text: c.text || '',
        quelle: 'airtable_import',
        created_at: c.createdTime || undefined,
      });
      kommentareTotal++;
    }
  }

  console.log(`[at-import] Fertig: ${created} neue Leads, ${skipped} skip, ${kommentareTotal} Kommentare.`);
  console.log(`[at-import] Portal: https://inside.talent-one.de → Kunden → ${kunde.firmenname}`);
  console.log(`[at-import] Portal-Token: ${kunde.portal_token} → /portal/${kunde.portal_token}`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
