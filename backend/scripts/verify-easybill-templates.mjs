// Einmaliger Verifikations-Lauf: erzeugt je Marke ein TEST-Angebot in easybill,
// prüft, dass pdf_template richtig gesetzt wurde, holt PDF + extrahiert Text,
// prüft auf Footer-Doubling (Impressum/UStID/HRB-Marker doppelt).
//
// Aufruf im Container: docker exec talentone-inside-backend node scripts/verify-easybill-templates.mjs
// Läuft mit SUPABASE_SERVICE_ROLE_KEY + EASYBILL_API_KEY aus dem Container-Env.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

import { supabase } from '../supabase.js';
import { buildEasybillOfferPayload } from '../offer-easybill-builder.js';
import { createOffer, getDocument, getDocumentPdf } from '../easybill.js';
import { getPdfTemplate } from '../easybill-templates.js';

// Zwei bewusst gewählte Kunden aus dem Cache — die Marke am Angebot bestimmt
// das Layout, nicht der Kunde.
const TEST_CUSTOMERS = {
  talentone:   { easybill_id: 2638685285, company_name: 'Neufend GmbH & Co. KG' },
  nowag_wirth: { easybill_id: 2638681556, company_name: 'Steinrücke-Felsengrund' },
};

async function verifyOneBrand(brand) {
  console.log('\n════════════════════════════════════════════════════');
  console.log('  MARKE:', brand);
  console.log('════════════════════════════════════════════════════');

  const cust = TEST_CUSTOMERS[brand];
  const expectedTpl = getPdfTemplate(brand, 'OFFER');
  console.log('  Kunde:', cust.company_name, '(easybill_id:', cust.easybill_id + ')');
  console.log('  Erwartete pdf_template-ID:', expectedTpl);

  // Katalog + Textbausteine laden
  const [{ data: products }, { data: templates }] = await Promise.all([
    supabase.from('talentone_offer_products').select('*').eq('brand', brand).eq('active', true),
    supabase.from('talentone_offer_templates').select('key, text').eq('brand', brand),
  ]);

  // Nur die Pflichtpositionen wählen (setup + monthly) — kompakteres PDF
  const pflicht = (products || []).filter(p => p.category === 'setup' || p.category === 'monthly');
  const selected = pflicht.map(p => ({ product_id: p.id }));

  const { items } = buildEasybillOfferPayload({
    brand,
    products: products || [],
    selected,
    ad_budget_monthly: brand === 'talentone' ? 800 : null,
    vat_rate: 19,
    templates: templates || [],
  });

  console.log('  Positions-Count:', items.length,
    '(davon TEXT:', items.filter(i => i.type === 'TEXT').length, ')');

  // easybill-Erzeugung
  const document = await createOffer({
    customerId:  cust.easybill_id,
    title:       `TEST — Vorlagen-Check ${brand.toUpperCase()}`,
    items,
    pdfTemplate: expectedTpl,
    externalId:  `TEST-VORLAGEN-CHECK-${brand}-${Date.now()}`,
  });
  console.log('  ✓ easybill Document erzeugt: id=' + document.id + ', number=' + (document.number || '?'));

  // Fetch full document zurück, um pdf_template zu prüfen
  const full = await getDocument(document.id);
  const actualTpl = full.pdf_template;
  console.log('  Zurückgeliefertes pdf_template:', actualTpl,
    actualTpl === expectedTpl ? '✓ MATCH' : '✗ MISMATCH');

  // PDF holen + Text extrahieren
  const pdfBuf = await getDocumentPdf(document.id);
  console.log('  PDF-Größe:', pdfBuf.length + ' Bytes');

  const parsed = await pdfParse(pdfBuf);
  const text = parsed.text;

  // Footer-Doubling-Check: Zähle typische Footer-Marker
  const markers = ['Nowag & Wirth', 'TalentOne', 'nowagwirth.com', 'talent-one.de',
                   'HRB', 'Amtsgericht', 'USt-ID', 'UStID', 'Steuernummer',
                   'IBAN', 'BIC', 'DE'];
  const found = {};
  for (const m of markers) {
    const re = new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matches = text.match(re);
    if (matches && matches.length) found[m] = matches.length;
  }
  console.log('  Marker-Zählung im PDF-Text:', JSON.stringify(found, null, 2).split('\n').join('\n    '));

  // Anzahl der Seiten (jede Seite hat üblicherweise 1 Footer)
  console.log('  Seiten:', parsed.numpages);

  // Impressum-Line-Detection: klassische Fußzeilen enthalten typisch mehrere Marker
  // pro Zeile. Wenn Marker-Zahlen > Seitenzahl → verdächtig auf Doubling.
  const suspects = [];
  for (const [m, count] of Object.entries(found)) {
    if (m === 'DE') continue; // "DE" kommt oft im Adressblock vor, ignorieren
    if (count > parsed.numpages) {
      suspects.push(`${m}: ${count}× (Seiten: ${parsed.numpages})`);
    }
  }
  if (suspects.length) {
    console.log('  ⚠ MÖGLICHES FOOTER-DOUBLING — Marker öfter als Seiten:');
    for (const s of suspects) console.log('     ·', s);
  } else {
    console.log('  ✓ Keine offensichtlichen Footer-Duplikate erkannt.');
  }

  // Erste + letzte 300 Zeichen des extrahierten Textes zeigen
  console.log('  --- Text-Anfang ---');
  console.log('    ' + text.slice(0, 200).replace(/\n/g, '\n    '));
  console.log('  --- Text-Ende ---');
  console.log('    ' + text.slice(-300).replace(/\n/g, '\n    '));

  return { brand, doc_id: document.id, doc_number: document.number,
           expected_tpl: expectedTpl, actual_tpl: actualTpl,
           match: actualTpl === expectedTpl, suspects };
}

const results = [];
for (const brand of ['talentone', 'nowag_wirth']) {
  try { results.push(await verifyOneBrand(brand)); }
  catch (err) {
    console.log('\n[' + brand + '] FEHLER:', err.message);
    results.push({ brand, error: err.message });
  }
}

console.log('\n════════════════════════════════════════════════════');
console.log('  ZUSAMMENFASSUNG');
console.log('════════════════════════════════════════════════════');
for (const r of results) {
  if (r.error) { console.log('  ✗', r.brand, '→', r.error); continue; }
  console.log('  ' + (r.match ? '✓' : '✗'), r.brand,
    '→ doc:', r.doc_id, '(', r.doc_number, ')',
    '· expected:', r.expected_tpl, '· actual:', r.actual_tpl,
    '· Footer-Doubling-Verdacht:', r.suspects.length ? 'JA' : 'nein');
}

process.exit(0);
