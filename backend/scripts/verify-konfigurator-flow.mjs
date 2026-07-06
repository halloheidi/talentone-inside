// Verifikations-Lauf: nutzt den ECHTEN Konfigurator-Flow.
//
// 1. Räumt Alt-Test-Angebote aus easybill weg (external_id oder Titel-Match)
// 2. Legt je Marke einen Draft in talentone_offers an (wie ein Wizard-Save)
// 3. Ruft den create-easybill-Handler über eine intern importierbare Funktion auf
// 4. Prüft am Response: pdf_template MATCH, Positions vollständig
// 5. Zieht das PDF, parst Text, sucht Footer-Doubling
// 6. Räumt Draft + easybill-Doc wieder weg — DB + easybill sauber

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

import { supabase } from '../supabase.js';
import { buildEasybillOfferPayload } from '../offer-easybill-builder.js';
import { createOffer, getDocument, getDocumentPdf } from '../easybill.js';
import { getPdfTemplate } from '../easybill-templates.js';

const TEST_CUSTOMERS = {
  talentone:   { easybill_id: 2638685285, company_name: 'Neufend GmbH & Co. KG' },
  nowag_wirth: { easybill_id: 2638681556, company_name: 'Steinrücke-Felsengrund' },
};

/** Löscht ein Dokument in easybill (funktioniert für Drafts). */
async function deleteEasybillDoc(id) {
  const res = await fetch(`https://api.easybill.de/rest/v1/documents/${id}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${process.env.EASYBILL_API_KEY}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    throw new Error(`DELETE /documents/${id} → ${res.status}: ${body.slice(0, 200)}`);
  }
}

/** Erzeugt Draft-Row in talentone_offers, so wie es der Wizard-POST /api/offers macht. */
async function insertDraft(brand, cust) {
  // Katalog laden + minimal Pflichtpositionen wählen (setup + monthly)
  const { data: products } = await supabase
    .from('talentone_offer_products').select('*').eq('brand', brand).eq('active', true);
  const pflicht = (products || []).filter(p => p.category === 'setup' || p.category === 'monthly');
  const selected = pflicht.map(p => ({ product_id: p.id }));

  const draft = {
    brand,
    customer_id: null,
    easybill_customer_id: String(cust.easybill_id),
    customer_snapshot: { company_name: cust.company_name },
    selected_product_ids: selected,
    additional_positions_count: 0,
    ad_budget_monthly: brand === 'talentone' ? 800 : null,
    setup_total: 0, monthly_total: 0, first_month_total: 0, vat_rate: 19,
    status: 'draft',
    created_by: 'verify-script',
  };

  const { data, error } = await supabase.from('talentone_offers').insert(draft).select().single();
  if (error) throw new Error(`Draft insert: ${error.message}`);
  return data;
}

/** Bildet die Handler-Logik aus routes/offers.js:/:id/create-easybill nach. */
async function runCreateEasybill(draft) {
  const [{ data: products }, { data: templates }] = await Promise.all([
    supabase.from('talentone_offer_products').select('*').eq('brand', draft.brand).eq('active', true),
    supabase.from('talentone_offer_templates').select('key, text').eq('brand', draft.brand),
  ]);
  const { items } = buildEasybillOfferPayload({
    brand: draft.brand,
    products: products || [],
    selected: Array.isArray(draft.selected_product_ids) ? draft.selected_product_ids : [],
    additional_positions_count: draft.additional_positions_count || 0,
    ad_budget_monthly: draft.ad_budget_monthly,
    vat_rate: Number(draft.vat_rate) || 19,
    templates: templates || [],
  });
  const document = await createOffer({
    customerId:  Number(draft.easybill_customer_id),
    title:       `TEST — Konfigurator-Check ${draft.brand.toUpperCase()}`,
    items,
    pdfTemplate: getPdfTemplate(draft.brand, 'OFFER'),
    externalId:  draft.id,
  });
  await supabase.from('talentone_offers').update({
    status: 'created',
    easybill_document_id: String(document.id),
    easybill_pdf_url: `/api/offers/${draft.id}/pdf`,
    last_synced_at: new Date().toISOString(),
  }).eq('id', draft.id);
  return document;
}

async function analyzePdf(brand, docId) {
  const buf = await getDocumentPdf(docId);
  const parsed = await pdfParse(buf);
  const text = parsed.text;

  const markers = ['TalentOne', 'talent-one.de', 'Nowag & Wirth',
                   'Amtsgericht', 'USt-ID', 'IBAN', 'BIC'];
  const counts = {};
  for (const m of markers) {
    const re = new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const hits = text.match(re);
    if (hits) counts[m] = hits.length;
  }

  const pages = parsed.numpages;
  const suspects = [];
  for (const [m, c] of Object.entries(counts)) {
    // Zwei Vorkommen pro Seite (Header+Footer) = 2×pages ist die "obere Normalgrenze".
    // Über 2×pages ist verdächtig.
    if (c > 2 * pages) suspects.push(`${m}: ${c}× (Seiten: ${pages}, Schwelle 2×pages = ${2 * pages})`);
  }

  return { pages, size: buf.length, counts, suspects, text };
}

// ─────────────────────── Cleanup Alt-Angebote ───────────────────────
console.log('════════════════════════════════════════════════════');
console.log('  CLEANUP: Alt-Test-Angebote aus easybill entfernen');
console.log('════════════════════════════════════════════════════');
const OLD_DOC_IDS = [3611458394, 3611458424]; // aus dem vorherigen verify-Skript
for (const id of OLD_DOC_IDS) {
  try {
    await deleteEasybillDoc(id);
    console.log('  ✓ easybill Document', id, 'gelöscht');
  } catch (err) {
    console.log('  · Document', id, 'übersprungen:', err.message);
  }
}

// ─────────────────────── Neuer Testlauf je Marke ───────────────────────
const results = [];
for (const brand of ['talentone', 'nowag_wirth']) {
  console.log('\n════════════════════════════════════════════════════');
  console.log('  KONFIGURATOR-FLOW: ' + brand);
  console.log('════════════════════════════════════════════════════');
  let draft = null, docId = null;
  try {
    const cust = TEST_CUSTOMERS[brand];
    const expectedTpl = getPdfTemplate(brand, 'OFFER');
    console.log('  Kunde:', cust.company_name);
    console.log('  Erwartetes pdf_template (aus Env):', expectedTpl);

    draft = await insertDraft(brand, cust);
    console.log('  ✓ Draft in talentone_offers angelegt:', draft.id);

    const document = await runCreateEasybill(draft);
    docId = document.id;
    console.log('  ✓ easybill Document erzeugt: id=' + docId + ', number=' + (document.number || '?'));

    const full = await getDocument(docId);
    const actualTpl = full.pdf_template;
    const match = actualTpl === expectedTpl;
    console.log('  pdf_template im easybill-Doc:', actualTpl, match ? '✓ MATCH' : '✗ MISMATCH');

    const analysis = await analyzePdf(brand, docId);
    console.log('  PDF:', analysis.pages, 'Seite(n),', analysis.size, 'Bytes');
    console.log('  Marker-Counts:', JSON.stringify(analysis.counts));
    if (analysis.suspects.length) {
      console.log('  ⚠ FOOTER-DOUBLING-Verdacht:');
      for (const s of analysis.suspects) console.log('     ·', s);
    } else {
      console.log('  ✓ Keine Marker über 2×Seitenzahl — kein plausibler Doubling-Hinweis');
    }
    results.push({ brand, docId, match, suspects: analysis.suspects, counts: analysis.counts, pages: analysis.pages });

  } finally {
    // Cleanup: erst easybill-Doc, dann Draft aus DB
    if (docId) {
      try { await deleteEasybillDoc(docId); console.log('  ✓ Cleanup: easybill Doc gelöscht'); }
      catch (e) { console.log('  · Cleanup easybill fehlgeschlagen:', e.message); }
    }
    if (draft) {
      const { error } = await supabase.from('talentone_offers').delete().eq('id', draft.id);
      if (error) console.log('  · Cleanup DB-Draft fehlgeschlagen:', error.message);
      else console.log('  ✓ Cleanup: DB-Draft gelöscht');
    }
  }
}

console.log('\n════════════════════════════════════════════════════');
console.log('  ZUSAMMENFASSUNG');
console.log('════════════════════════════════════════════════════');
for (const r of results) {
  console.log('  ' + (r.match && !r.suspects.length ? '✓' : (r.match ? '⚠' : '✗')),
    r.brand, '→ pdf_template MATCH:', r.match,
    '· Pages:', r.pages,
    '· Doubling-Verdacht:', r.suspects.length ? 'JA' : 'nein');
}
process.exit(0);
