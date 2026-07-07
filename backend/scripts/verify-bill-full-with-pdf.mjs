// TalentOne bill_full Nachweis MIT PDF-Beleg. Erzeugt ein Testangebot,
// aktiviert die Abrechnung mit campaign_started_at innerhalb der 30-Tage-
// Frist, ruft run-now, dokumentiert die easybill-doc-id und die Positions-
// Beträge aus GET /documents/{id}, lädt das PDF und legt es unter
// /tmp/talentone-bill-full-nachweis.pdf ab. Danach Cleanup.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
import fs from 'fs/promises';

import { supabase } from '../supabase.js';
import { buildEasybillOfferPayload } from '../offer-easybill-builder.js';
import { createOffer, getDocument, getDocumentPdf, finalizeInvoice } from '../easybill.js';
import { getPdfTemplate } from '../easybill-templates.js';
import { applyAcceptedTransition } from '../offer-sync.js';
import { runMonthlyBillingForOffer } from '../invoice-service.js';

const CUST = { easybill_id: 2638685285, company_name: 'Neufend GmbH & Co. KG' };
const EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const centsToEuro = c => Math.round(Number(c || 0)) / 100;
const OUT_PATH = '/tmp/talentone-bill-full-nachweis.pdf';

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
    created_by: 'verify-bill-full-with-pdf',
  }).select().single();
  draftId = draft.id;
  const doc = await createOffer({
    customerId: CUST.easybill_id, title: 'TEST bill_full mit PDF-Beleg',
    items, pdfTemplate: getPdfTemplate(brand, 'OFFER'), externalId: draft.id,
  });
  offerDocId = doc.id;
  await supabase.from('talentone_offers').update({
    status: 'created', easybill_document_id: String(doc.id),
  }).eq('id', draft.id);
  await finalizeInvoice(offerDocId);
  const ab = await convertToAb(offerDocId);
  abDocId = ab.id;
  const offerA = await supabase.from('talentone_offers').select('*').eq('id', draft.id).single();
  await applyAcceptedTransition(offerA.data, ab);

  // Aktivierung: HEUTE — Periode für Folgemonat ist innerhalb der 30-Tage-Frist
  await supabase.from('talentone_offers').update({
    campaign_started_at: new Date().toISOString().slice(0, 10),
  }).eq('id', draft.id);

  const next = new Date(); next.setMonth(next.getMonth() + 1); next.setDate(1);
  const periodStart = next.toISOString().slice(0, 10);
  const r = await runMonthlyBillingForOffer(draft.id, { today: new Date(), periodStart });
  if (r.action !== 'bill_full') throw new Error(`Erwartet bill_full, bekam ${r.action}`);
  if (r.invoice.invoice_type !== 'monthly_combined') throw new Error(`Erwartet monthly_combined, bekam ${r.invoice.invoice_type}`);
  monthlyDocId = r.invoice.easybill_document_id;

  console.log('══════════════════════════════════════════════════════════════════');
  console.log('  TalentOne bill_full mit Werbebudget — Nachweis');
  console.log('══════════════════════════════════════════════════════════════════');
  console.log(`Angebot (DB): ${draft.id}`);
  console.log(`Angebot (easybill OFFER): ${offerDocId}`);
  console.log(`Auftragsbestätigung (easybill CHARGE_CONFIRM): ${abDocId}`);
  console.log('');
  console.log(`▶ Monatliche Rechnung (easybill INVOICE):`);
  console.log(`  easybill_document_id: ${monthlyDocId}`);
  console.log(`  invoice_type (DB):    ${r.invoice.invoice_type}`);
  console.log('');

  // GET /documents/{id} → Positionen belegen
  const full = await getDocument(monthlyDocId);
  const pos = (full.items || []).filter(p => p.type !== 'TEXT');
  console.log(`▶ Positionen aus GET /documents/${monthlyDocId} (Nicht-TEXT):`);
  for (const p of pos) {
    const first = String(p.description || '').split('\n')[0];
    console.log(`  #${p.position}  ${first}`);
    console.log(`     quantity=${p.quantity} · single_price_net=${p.single_price_net} Cent = ${EUR.format(centsToEuro(p.single_price_net))}`);
  }
  console.log('');
  console.log(`▶ Doc-Summen:`);
  console.log(`  amount_net (Cent) = ${full.amount_net} → ${EUR.format(centsToEuro(full.amount_net))}`);
  console.log(`  amount     (Cent) = ${full.amount}     → ${EUR.format(centsToEuro(full.amount))}`);

  const svc = pos.find(p => String(p.description).startsWith('Kampagnen-Ausstrahlung'));
  const bud = pos.find(p => String(p.description).startsWith('Werbebudget'));
  console.log('');
  console.log('══════════════════════════════════════════════════════════════════');
  console.log('  VERIFIKATION');
  console.log('══════════════════════════════════════════════════════════════════');
  console.log(`  Servicepauschale:     ${svc ? '✓ ' + EUR.format(centsToEuro(svc.single_price_net)) : '✗ FEHLT'}  (erwartet 1.490,00 €)`);
  console.log(`  Werbebudget:          ${bud ? '✓ ' + EUR.format(centsToEuro(bud.single_price_net)) : '✗ FEHLT'}  (erwartet   800,00 €)`);
  console.log(`  Doc netto:            ${EUR.format(centsToEuro(full.amount_net))}  (erwartet 2.290,00 €)`);
  console.log(`  Doc brutto:           ${EUR.format(centsToEuro(full.amount))}  (erwartet 2.725,10 €)`);
  console.log(`  Positionstext Budget enthält "Vorauszahlung": ${String(bud?.description || '').includes('Vorauszahlung') ? '✓' : '✗'}`);

  // PDF laden + speichern + Text-Extrakt
  const pdfBuf = await getDocumentPdf(monthlyDocId);
  await fs.writeFile(OUT_PATH, pdfBuf);
  console.log('');
  console.log(`▶ PDF gespeichert unter: ${OUT_PATH}  (${pdfBuf.length} Bytes)`);

  const parsed = await pdfParse(pdfBuf);
  console.log(`▶ PDF-Seiten: ${parsed.numpages}`);
  console.log('');
  console.log('▶ Auszug relevanter Zeilen aus dem PDF-Text:');
  const relevant = parsed.text.split('\n').filter(l =>
    /Kampagnen|Werbebudget|Nettobetrag|Umsatzsteuer|Rechnungsbetrag|monatlich|Vorauszahlung|Position|1\.490|800|2\.290|2\.725/.test(l)
  );
  for (const l of relevant.slice(0, 30)) console.log('   ' + l.trim());

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
  console.log('  ✓ Test-Angebot, AB und monatliche Rechnung aus easybill + DB entfernt');
  console.log(`  ℹ PDF bleibt zum Herunterladen: ${OUT_PATH}`);
  process.exit(0);
}
