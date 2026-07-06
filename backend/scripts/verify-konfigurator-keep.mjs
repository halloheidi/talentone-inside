// Wie verify-konfigurator-flow.mjs, aber OHNE Cleanup — die Test-Angebote
// bleiben in easybill zur visuellen Prüfung. Danach über
// scripts/cleanup-test-offers.mjs entfernen.

import { supabase } from '../supabase.js';
import { buildEasybillOfferPayload } from '../offer-easybill-builder.js';
import { calculateOfferTotals } from '../offer-calc.js';
import { createOffer, getDocument } from '../easybill.js';
import { getPdfTemplate } from '../easybill-templates.js';

const EXTRA_JOB_SKU_BY_BRAND = { talentone: 'TO-OPT-EXTRA-JOB', nowag_wirth: 'NW-OPT-EXTRA-JOB' };
const centsToEuros = c => Math.round(Number(c || 0)) / 100;
const eur = v => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(v);

const TEST_CUSTOMERS = {
  talentone:   { easybill_id: 2638685285, company_name: 'Neufend GmbH & Co. KG' },
  nowag_wirth: { easybill_id: 2638681556, company_name: 'Steinrücke-Felsengrund' },
};

for (const brand of ['talentone', 'nowag_wirth']) {
  console.log('\n════ ' + brand + ' ════');
  const cust = TEST_CUSTOMERS[brand];
  const expectedTpl = getPdfTemplate(brand, 'OFFER');

  const [{ data: products }, { data: templates }] = await Promise.all([
    supabase.from('talentone_offer_products').select('*').eq('brand', brand).eq('active', true),
    supabase.from('talentone_offer_templates').select('key, text').eq('brand', brand),
  ]);
  const pflicht = (products || []).filter(p => p.category === 'setup' || p.category === 'monthly');
  const selected = pflicht.map(p => ({ product_id: p.id }));

  // Draft in DB
  const { data: draft, error } = await supabase.from('talentone_offers').insert({
    brand,
    easybill_customer_id: String(cust.easybill_id),
    customer_snapshot: { company_name: cust.company_name },
    selected_product_ids: selected,
    additional_positions_count: 0,
    ad_budget_monthly: brand === 'talentone' ? 800 : null,
    setup_total: 0, monthly_total: 0, first_month_total: 0, vat_rate: 19,
    status: 'draft',
    created_by: 'verify-keep-script',
  }).select().single();
  if (error) { console.log('Draft insert:', error.message); continue; }
  console.log('  Draft-ID:', draft.id);

  // Positions bauen
  const { items, totals } = buildEasybillOfferPayload({
    brand, products: products || [], selected,
    ad_budget_monthly: draft.ad_budget_monthly,
    vat_rate: 19,
    templates: templates || [],
  });
  console.log('  Positionen:', items.length,
    '(davon TEXT/Schluss:', items.filter(i => i.type === 'TEXT').length, ')');
  console.log('  Berechnete Summen: setup=' + totals.setup_total,
    'monthly=' + totals.monthly_total,
    'first_month=' + totals.first_month_total,
    'ad_budget=' + totals.ad_budget_monthly);

  const document = await createOffer({
    customerId: cust.easybill_id,
    title: `TEST — Konfigurator-Check ${brand.toUpperCase()} (bitte prüfen und löschen)`,
    items,
    pdfTemplate: expectedTpl,
    externalId: draft.id,
  });

  await supabase.from('talentone_offers').update({
    status: 'created',
    easybill_document_id: String(document.id),
    easybill_pdf_url: `/api/offers/${draft.id}/pdf`,
    setup_total: totals.setup_total,
    monthly_total: totals.monthly_total,
    first_month_total: totals.first_month_total,
    ad_budget_monthly: totals.ad_budget_monthly || null,
    last_synced_at: new Date().toISOString(),
  }).eq('id', draft.id);

  const full = await getDocument(document.id);
  console.log('  easybill doc-id:', document.id, '· pdf_template:', full.pdf_template,
    full.pdf_template === expectedTpl ? '✓ MATCH' : '✗ MISMATCH');

  // Cross-Check: was easybill zurückgibt vs. was calculateOfferTotals sagt.
  const expected = calculateOfferTotals({
    products: products || [],
    selected,
    additional_positions_count: 0,
    ad_budget_monthly: draft.ad_budget_monthly,
    vat_rate: 19,
    extra_job_sku: EXTRA_JOB_SKU_BY_BRAND[brand] || null,
  });

  // easybill legt bei OFFER üblicherweise Summen-Felder ans Document — je nach
  // Schema als amount, amount_net, sum_net, sum_gross usw. Wir prüfen die
  // Positions-Summe (aus items[]) und optional die aggregierte Summe im Doc.
  const posSumCents = Array.isArray(full.items)
    ? full.items
        .filter(p => p.type !== 'TEXT')
        .reduce((s, p) => s + Math.round((Number(p.single_price_net) || 0) * (Number(p.quantity) || 1)), 0)
    : null;
  const expectedFirstMonthCents = Math.round(expected.first_month_total * 100);

  console.log('  Berechnung (calc):',
    'setup=' + eur(expected.setup_total),
    '· monthly=' + eur(expected.monthly_total),
    '· first_month=' + eur(expected.first_month_total),
    '(brutto ' + eur(expected.gross.first_month_gross) + ')');
  if (posSumCents != null) {
    console.log('  Summe aus easybill-items[]:', eur(centsToEuros(posSumCents)),
      posSumCents === expectedFirstMonthCents ? '✓ MATCH' : '✗ MISMATCH');
  }
  // Doc-Summen-Felder (readOnly, easybill-berechnet)
  for (const k of ['amount_net', 'sum_net', 'total_net', 'amount', 'sum']) {
    if (full[k] != null) console.log('  easybill doc.' + k + ':', full[k], '(Cent) =', eur(centsToEuros(full[k])));
  }
  console.log('  → PDF direkt in easybill: Doc-ID ' + document.id);
  console.log('  → PDF im Tool: https://inside.talent-one.de/angebote (📄-Button)');
}
process.exit(0);
