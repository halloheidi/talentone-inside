// E2E-Test des Rücksync-Flows (Phase 4):
//
// 1. Erzeuge ein Testangebot in easybill (Konfigurator-Flow)
// 2. Wandle es in easybill in eine Auftragsbestätigung um (POST /documents/{id}/CHARGE_CONFIRM)
// 3. Rufe syncOne() auf — soll status='accepted' + easybill_order_document_id setzen
// 4. Rufe syncOne nochmal auf — soll no-op sein (Idempotenz)
// 5. Räume beide easybill-Docs + DB-Draft auf

import { supabase } from '../supabase.js';
import { buildEasybillOfferPayload } from '../offer-easybill-builder.js';
import { createOffer, getDocument, finalizeInvoice } from '../easybill.js';
import { getPdfTemplate } from '../easybill-templates.js';
import { syncOne } from '../offer-sync.js';

const BRAND = 'talentone';
const CUST  = { easybill_id: 2638685285, company_name: 'Neufend GmbH & Co. KG' };

async function convertToAb(offerDocId) {
  const url = `https://api.easybill.de/rest/v1/documents/${offerDocId}/CHARGE_CONFIRM`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.EASYBILL_API_KEY}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Convert → ${res.status}: ${body.slice(0, 300)}`);
  return JSON.parse(body);
}

async function deleteEasybillDoc(id) {
  const res = await fetch(`https://api.easybill.de/rest/v1/documents/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${process.env.EASYBILL_API_KEY}` },
  });
  if (!res.ok && res.status !== 404) throw new Error(`Delete ${id}: ${res.status}`);
}

console.log('════════════════════════════════════════════════════');
console.log('  Phase 4 — E2E Rücksync-Test');
console.log('════════════════════════════════════════════════════');

let draft = null;
let offerDocId = null;
let abDocId = null;
let caughtError = null;

try {
  // 1. Angebot in DB + easybill anlegen
  const [{ data: products }, { data: templates }] = await Promise.all([
    supabase.from('talentone_offer_products').select('*').eq('brand', BRAND).eq('active', true),
    supabase.from('talentone_offer_templates').select('key, text').eq('brand', BRAND),
  ]);
  const pflicht = (products || []).filter(p => p.category === 'setup' || p.category === 'monthly');
  const selected = pflicht.map(p => ({ product_id: p.id }));

  const { data: d, error } = await supabase.from('talentone_offers').insert({
    brand: BRAND,
    easybill_customer_id: String(CUST.easybill_id),
    customer_snapshot: { company_name: CUST.company_name },
    selected_product_ids: selected,
    ad_budget_monthly: 800,
    setup_total: 0, monthly_total: 0, first_month_total: 0, vat_rate: 19,
    status: 'draft', created_by: 'verify-resync-script',
  }).select().single();
  if (error) throw new Error(`Draft: ${error.message}`);
  draft = d;
  console.log('1. Draft in DB:', draft.id);

  const { items } = buildEasybillOfferPayload({
    brand: BRAND, products, selected, ad_budget_monthly: 800, vat_rate: 19, templates,
  });
  const doc = await createOffer({
    customerId: CUST.easybill_id,
    title: 'TEST — Resync-Test (bitte nicht anfassen)',
    items,
    pdfTemplate: getPdfTemplate(BRAND, 'OFFER'),
    externalId: draft.id,
  });
  offerDocId = doc.id;
  await supabase.from('talentone_offers').update({
    status: 'created', easybill_document_id: String(offerDocId),
    easybill_pdf_url: `/api/offers/${draft.id}/pdf`,
    last_synced_at: new Date().toISOString(),
  }).eq('id', draft.id);
  console.log('   easybill OFFER doc:', offerDocId);

  // 2. Baseline-Sync: kein Nachfolger da → keine Änderung
  const { data: preOffer } = await supabase.from('talentone_offers').select('*').eq('id', draft.id).single();
  const baseline = await syncOne(preOffer);
  console.log('2. Sync vor Umwandlung: changed=' + baseline.changed + ', checked=' + baseline.checked);

  // 3a. Finalisieren (raus aus dem Entwurfsmodus — sonst blockt easybill den Convert)
  await finalizeInvoice(offerDocId);
  console.log('3a. OFFER finalisiert (raus aus Entwurfsmodus)');

  // 3b. In easybill in eine CHARGE_CONFIRM umwandeln
  const ab = await convertToAb(offerDocId);
  abDocId = ab.id;
  console.log('3. Auftragsbestätigung erzeugt: ' + abDocId + ' (ref_id → ' + ab.ref_id + ')');

  // 4. Nochmal syncen — sollte jetzt status=accepted setzen
  const { data: offerNow } = await supabase.from('talentone_offers').select('*').eq('id', draft.id).single();
  const first = await syncOne(offerNow);
  console.log('4. Sync nach Umwandlung: changed=' + first.changed);
  const { data: after } = await supabase.from('talentone_offers').select('*').eq('id', draft.id).single();
  console.log('   status=' + after.status + ', order_document_id=' + after.easybill_order_document_id
    + ', accepted_at=' + after.accepted_at);
  const acceptedOk =
    after.status === 'accepted' &&
    after.easybill_order_document_id === String(abDocId) &&
    !!after.accepted_at;
  console.log('   Status-Transition:', acceptedOk ? '✓ OK' : '✗ FEHLGESCHLAGEN');

  // 5. Idempotenz: erneuter Sync darf accepted_at nicht ändern
  const acceptedAtBefore = after.accepted_at;
  const orderIdBefore    = after.easybill_order_document_id;
  const second = await syncOne(after);
  const { data: afterAgain } = await supabase.from('talentone_offers').select('*').eq('id', draft.id).single();
  console.log('5. Sync ein zweites Mal: changed=' + second.changed);
  const idempotent =
    afterAgain.accepted_at === acceptedAtBefore &&
    afterAgain.easybill_order_document_id === orderIdBefore &&
    afterAgain.last_synced_at !== after.last_synced_at;
  console.log('   Idempotenz (accepted_at unverändert, last_synced_at bewegt):',
    idempotent ? '✓ OK' : '✗ FEHLGESCHLAGEN');

  console.log('');
  console.log('════════════════════════════════════════════════════');
  console.log('  ZUSAMMENFASSUNG:', (acceptedOk && idempotent) ? '✓ Phase 4 verhält sich korrekt' : '✗ Fehler siehe oben');
  console.log('════════════════════════════════════════════════════');
} catch (err) {
  caughtError = err;
  console.log('\n✗ FEHLER:', err.message);
  console.log(err.stack);
} finally {
  // Cleanup
  console.log('\nCleanup:');
  if (abDocId)   { try { await deleteEasybillDoc(abDocId);    console.log('  ✓ easybill AB ' + abDocId + ' gelöscht'); }    catch (e) { console.log('  · AB-Cleanup:', e.message); } }
  if (offerDocId){ try { await deleteEasybillDoc(offerDocId); console.log('  ✓ easybill OFFER ' + offerDocId + ' gelöscht'); } catch (e) { console.log('  · OFFER-Cleanup:', e.message); } }
  if (draft) {
    const { error } = await supabase.from('talentone_offers').delete().eq('id', draft.id);
    console.log('  ' + (error ? '·' : '✓') + ' DB-Draft ' + draft.id + (error ? ' Fehler: ' + error.message : ' gelöscht'));
  }
  process.exit(caughtError ? 1 : 0);
}
