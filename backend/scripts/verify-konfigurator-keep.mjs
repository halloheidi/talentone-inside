// Wie verify-konfigurator-flow.mjs, aber OHNE Cleanup — die Test-Angebote
// bleiben in easybill zur visuellen Prüfung. Danach über
// scripts/cleanup-test-offers.mjs entfernen.

import { supabase } from '../supabase.js';
import { buildEasybillOfferPayload } from '../offer-easybill-builder.js';
import { createOffer, getDocument } from '../easybill.js';
import { getPdfTemplate } from '../easybill-templates.js';

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
  console.log('  → PDF im Tool: https://inside.talent-one.de/angebote (📄-Button)');
  console.log('  → PDF direkt in easybill: Doc-ID ' + document.id);
}
process.exit(0);
