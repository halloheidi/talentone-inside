// Mini-Nachweis: TalentOne, INNERHALB Frist → bill_full erzeugt
// monthly_combined mit Service + Werbebudget als zwei Positionen.
// Cleanup restlos.

import { supabase } from '../supabase.js';
import { buildEasybillOfferPayload } from '../offer-easybill-builder.js';
import { createOffer, getDocument, finalizeInvoice } from '../easybill.js';
import { getPdfTemplate } from '../easybill-templates.js';
import { applyAcceptedTransition } from '../offer-sync.js';
import { runMonthlyBillingForOffer } from '../invoice-service.js';

const CUST = { easybill_id: 2638685285, company_name: 'Neufend GmbH & Co. KG' };
const EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const centsToEuro = c => Math.round(Number(c || 0)) / 100;

async function convertToAb(id) {
  const r = await fetch(`https://api.easybill.de/rest/v1/documents/${id}/CHARGE_CONFIRM`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.EASYBILL_API_KEY}` },
  });
  const b = await r.text();
  if (!r.ok) throw new Error(`Convert ${r.status}: ${b.slice(0, 200)}`);
  return JSON.parse(b);
}
async function delDoc(id) {
  await fetch(`https://api.easybill.de/rest/v1/documents/${id}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${process.env.EASYBILL_API_KEY}` },
  });
}

let draftId, offerDocId, abDocId, monthlyDocId;
try {
  // 1. Angebot mit Werbebudget 800 €, hires_target 1
  const brand = 'talentone';
  const [{ data: products }, { data: templates }] = await Promise.all([
    supabase.from('talentone_offer_products').select('*').eq('brand', brand).eq('active', true),
    supabase.from('talentone_offer_templates').select('key, text').eq('brand', brand),
  ]);
  const pflicht = (products || []).filter(p => p.category === 'setup' || p.category === 'monthly');
  const selected = pflicht.map(p => ({ product_id: p.id }));
  const { items, totals } = buildEasybillOfferPayload({
    brand, products, selected, ad_budget_monthly: 800, vat_rate: 19, templates,
  });
  const { data: draft } = await supabase.from('talentone_offers').insert({
    brand, easybill_customer_id: String(CUST.easybill_id),
    customer_snapshot: { company_name: CUST.company_name },
    selected_product_ids: selected, ad_budget_monthly: 800,
    setup_total: totals.setup_total,
    monthly_total: totals.monthly_total,
    first_month_total: totals.first_month_total,
    vat_rate: 19, status: 'draft',
    guarantee_period_days: 30, hires_target: 1,
    created_by: 'verify-bill-full',
  }).select().single();
  draftId = draft.id;
  const doc = await createOffer({
    customerId: CUST.easybill_id,
    title: 'TEST bill_full monthly_combined',
    items, pdfTemplate: getPdfTemplate(brand, 'OFFER'),
    externalId: draft.id,
  });
  offerDocId = doc.id;
  await supabase.from('talentone_offers').update({
    status: 'created', easybill_document_id: String(doc.id),
    easybill_pdf_url: `/api/offers/${draft.id}/pdf`,
  }).eq('id', draft.id);
  console.log(`1) Angebot: draft=${draft.id.slice(0,8)} easybill=${offerDocId}`);
  console.log(`   Erwartet: Service ${EUR.format(totals.monthly_total)} + Budget ${EUR.format(800)} = ${EUR.format(totals.monthly_total + 800)}`);

  // 2. Finalisieren + AB + accepted
  await finalizeInvoice(offerDocId);
  const ab = await convertToAb(offerDocId);
  abDocId = ab.id;
  const offerA = await supabase.from('talentone_offers').select('*').eq('id', draft.id).single();
  await applyAcceptedTransition(offerA.data, ab);
  console.log(`2) accepted ✓`);

  // 3. Aktivieren HEUTE (innerhalb Frist)
  await supabase.from('talentone_offers').update({ campaign_started_at: new Date().toISOString().slice(0, 10) }).eq('id', draft.id);
  console.log(`3) Aktiv seit heute — innerhalb Frist`);

  // 4. Monatslauf für den Folgemonat
  const next = new Date(); next.setMonth(next.getMonth() + 1); next.setDate(1);
  const periodStart = next.toISOString().slice(0, 10);
  const r = await runMonthlyBillingForOffer(draft.id, { today: new Date(), periodStart });
  console.log(`4) run-now: action=${r.action}${r.invoice ? ` invoice_type=${r.invoice.invoice_type}` : ''}`);
  if (r.action !== 'bill_full') throw new Error(`Erwartet bill_full, bekam ${r.action}`);
  if (r.invoice.invoice_type !== 'monthly_combined') throw new Error(`Erwartet monthly_combined, bekam ${r.invoice.invoice_type}`);

  monthlyDocId = r.invoice.easybill_document_id;
  const monthlyDoc = await getDocument(monthlyDocId);
  const posItems = (monthlyDoc.items || []).filter(p => p.type !== 'TEXT');
  console.log(`5) easybill-INVOICE ${monthlyDocId} · Positionen (Nicht-TEXT):`);
  for (const p of posItems) {
    const first = String(p.description || '').split('\n')[0];
    const priceEur = centsToEuro(p.single_price_net);
    console.log(`   • ${first} — ${p.quantity}× ${EUR.format(priceEur)} = ${EUR.format(priceEur * p.quantity)}`);
  }
  console.log(`6) Doc-Summen: netto=${EUR.format(centsToEuro(monthlyDoc.amount_net))}, brutto=${EUR.format(centsToEuro(monthlyDoc.amount))}`);

  // Erwartung: 2 Positionen = Service (1490 €) + Werbebudget (800 €) = 2290 € netto
  const svc = posItems.find(p => String(p.description).startsWith('Kampagnen-Ausstrahlung'));
  const bud = posItems.find(p => String(p.description).startsWith('Werbebudget'));
  console.log(`\n═══ VERIFIKATION ═══`);
  console.log(`Position 1 (Service): ${svc ? '✓ ' + EUR.format(centsToEuro(svc.single_price_net)) : '✗ FEHLT'}`);
  console.log(`Position 2 (Budget):  ${bud ? '✓ ' + EUR.format(centsToEuro(bud.single_price_net)) : '✗ FEHLT'}`);
  console.log(`Doc-netto:            ${EUR.format(centsToEuro(monthlyDoc.amount_net))} (erwartet ${EUR.format(1490 + 800)})`);
  console.log(`invoice_type in DB:   ${r.invoice.invoice_type} ${r.invoice.invoice_type === 'monthly_combined' ? '✓' : '✗'}`);
} catch (err) {
  console.log('\n✗ FEHLER:', err.message);
  console.log(err.stack);
} finally {
  console.log('\nCleanup…');
  if (monthlyDocId) await delDoc(monthlyDocId);
  if (abDocId)      await delDoc(abDocId);
  if (offerDocId)   await delDoc(offerDocId);
  if (draftId) {
    await supabase.from('talentone_invoices').delete().eq('offer_id', draftId);
    await supabase.from('talentone_billing_skip_log').delete().eq('offer_id', draftId);
    await supabase.from('talentone_offers').delete().eq('id', draftId);
  }
  console.log('  ✓ restlos aufgeräumt');
  process.exit(0);
}
