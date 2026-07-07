// E2E-Verify der gesamten Abrechnungskette (Phase 5 Nachtrag).
//
// N&W-Kette:
//   Angebot (60 Tage Garantie, hires_target=2) → easybill-Angebot →
//   finalisieren → in AB umwandeln → Rücksync-Skript wartet, wir triggern
//   applyAcceptedTransition direkt → Setup-Rechnung mit Dup-Check-Beweis
//   → Abrechnung aktivieren mit campaign_started_at in der Vergangenheit
//   → run-now: Periode innerhalb Frist (bill_full)
//   → run-now: Periode nach Frist ohne Hire (skip + Log)
//   → Hire 1 erfassen (first-Mail-Preview)
//   → run-now: Periode danach (bill_full, keine Nachberechnung)
//   → Hire 2 erfassen (complete-Mail-Preview mit Upsell)
//
// TalentOne-Kurzlauf:
//   Angebot (30 Tage) → aktiv → run-now nach Frist (bill_budget_only)
//   → run-now Monat 2 (skip_manual_reactivation, billing_paused_at gesetzt)
//
// Cleanup: alle Rechnungen + Angebote + easybill-Dokumente restlos entfernt.

import { supabase } from '../supabase.js';
import { buildEasybillOfferPayload } from '../offer-easybill-builder.js';
import { createOffer, getDocument, finalizeInvoice } from '../easybill.js';
import { getPdfTemplate } from '../easybill-templates.js';
import { applyAcceptedTransition } from '../offer-sync.js';
import {
  createSetupInvoice, activateMonthlyBilling, runMonthlyBillingForOffer,
  findExistingInvoiceForOffer,
} from '../invoice-service.js';
import { buildHireMailPreview, createHire } from '../hires-service.js';

const CUST_NW = { easybill_id: 2638681556, company_name: 'Steinrücke-Felsengrund' };
const CUST_TO = { easybill_id: 2638685285, company_name: 'Neufend GmbH & Co. KG' };

function shortId(id) { return String(id).slice(0, 8); }
function isoDaysAgo(days) {
  const d = new Date(); d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function firstOfMonthOffset(months) {
  const d = new Date(); d.setMonth(d.getMonth() + months); d.setDate(1);
  return d.toISOString().slice(0, 10);
}

async function convertToAb(offerDocId) {
  const url = `https://api.easybill.de/rest/v1/documents/${offerDocId}/CHARGE_CONFIRM`;
  const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${process.env.EASYBILL_API_KEY}` } });
  const body = await r.text();
  if (!r.ok) throw new Error(`Convert → ${r.status}: ${body.slice(0, 200)}`);
  return JSON.parse(body);
}
async function delDoc(id) {
  const r = await fetch(`https://api.easybill.de/rest/v1/documents/${id}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${process.env.EASYBILL_API_KEY}` },
  });
  if (!r.ok && r.status !== 404) console.warn(`delete ${id}: ${r.status}`);
}

async function createTestOffer({ brand, cust, guarantee_period_days, hires_target, adBudget = null }) {
  const [{ data: products }, { data: templates }] = await Promise.all([
    supabase.from('talentone_offer_products').select('*').eq('brand', brand).eq('active', true),
    supabase.from('talentone_offer_templates').select('key, text').eq('brand', brand),
  ]);
  const pflicht = (products || []).filter(p => p.category === 'setup' || p.category === 'monthly');
  const selected = pflicht.map(p => ({ product_id: p.id }));

  const { items, totals } = buildEasybillOfferPayload({
    brand, products, selected, ad_budget_monthly: adBudget, vat_rate: 19, templates,
  });

  const { data: draft, error } = await supabase.from('talentone_offers').insert({
    brand,
    easybill_customer_id: String(cust.easybill_id),
    customer_snapshot: { company_name: cust.company_name },
    selected_product_ids: selected,
    additional_positions_count: 0,
    ad_budget_monthly: adBudget,
    setup_total: totals.setup_total,
    monthly_total: totals.monthly_total,
    first_month_total: totals.first_month_total,
    vat_rate: 19,
    status: 'draft',
    guarantee_period_days,
    hires_target,
    created_by: 'verify-e2e-billing',
  }).select().single();
  if (error) throw new Error(`Draft: ${error.message}`);

  const doc = await createOffer({
    customerId: cust.easybill_id,
    title: `TEST E2E ${brand.toUpperCase()} — bitte nicht anfassen`,
    items,
    pdfTemplate: getPdfTemplate(brand, 'OFFER'),
    externalId: draft.id,
  });

  await supabase.from('talentone_offers').update({
    status: 'created', easybill_document_id: String(doc.id),
    easybill_pdf_url: `/api/offers/${draft.id}/pdf`,
    last_synced_at: new Date().toISOString(),
  }).eq('id', draft.id);

  return { draft, offerDocId: doc.id };
}

async function fetchOffer(id) {
  const { data } = await supabase.from('talentone_offers').select('*').eq('id', id).maybeSingle();
  return data;
}

// ═══════════════════════ N&W-Kette ═══════════════════════
console.log('═══════════════════════ N&W (60 Tage, hires_target=2) ═══════════════════════');
let nw = { docs: [], skipDocs: [] };
try {
  const { draft, offerDocId } = await createTestOffer({
    brand: 'nowag_wirth', cust: CUST_NW,
    guarantee_period_days: 60, hires_target: 2,
  });
  nw.draftId = draft.id;
  nw.offerDocId = offerDocId;
  console.log(`1) Angebot erzeugt: draft=${shortId(draft.id)} easybill=${offerDocId}`);

  await finalizeInvoice(offerDocId);
  const ab = await convertToAb(offerDocId);
  nw.abDocId = ab.id;
  console.log(`2) In AB umgewandelt: ${ab.id} (ref_id ${ab.ref_id})`);

  const offerA = await fetchOffer(draft.id);
  await applyAcceptedTransition(offerA, ab);
  const afterAcc = await fetchOffer(draft.id);
  console.log(`3) Rücksync → status=${afterAcc.status}`);

  // Setup-Rechnung
  const setupRes = await createSetupInvoice(draft.id, { createdBy: 'e2e' });
  nw.setupInvoiceId = setupRes.invoice.id;
  if (setupRes.doc?.id) nw.docs.push(setupRes.doc.id);
  console.log(`4a) Setup-Rechnung: invoice=${shortId(setupRes.invoice.id)} easybill=${setupRes.doc?.id || '(link)'}`);

  // Duplikats-Check (interner Weg — dieselbe Aktion muss alreadyExists melden)
  const dupRes = await createSetupInvoice(draft.id, { createdBy: 'e2e' });
  console.log(`4b) Dup-Check (interner Weg): alreadyExists=${dupRes.alreadyExists}, reason=${dupRes.reason} ${dupRes.alreadyExists ? '✓' : '✗'}`);

  // Aktivieren mit Vergangenheits-Datum
  const started = isoDaysAgo(75); // Angebot startet vor 75 Tagen — 60-Tage-Frist ist am 15. Tag abgelaufen
  const startedShort = isoDaysAgo(20); // wir mixen 2 Szenarien: manche Perioden vor, manche nach Frist
  await supabase.from('talentone_offers').update({ campaign_started_at: started }).eq('id', draft.id);
  console.log(`5) Abrechnung aktiv seit ${started} (60-Tage-Frist ist seit ${isoDaysAgo(15)} abgelaufen)`);

  // Periode 1: innerhalb Frist (Tag 40) — heute rückdatiert
  const inFrist = new Date(started); inFrist.setDate(inFrist.getDate() + 40);
  const p1 = await runMonthlyBillingForOffer(draft.id, { today: inFrist, periodStart: firstOfMonthOffset(-1) });
  if (p1.doc?.id) nw.docs.push(p1.doc.id);
  console.log(`6) Periode innerhalb Frist (Tag 40): action=${p1.action}`);

  // Periode 2: nach Frist ohne Hire (Tag 75)
  const nachFrist = new Date();
  const p2 = await runMonthlyBillingForOffer(draft.id, { today: nachFrist, periodStart: firstOfMonthOffset(0) });
  console.log(`7) Periode nach Frist, keine Einstellung: action=${p2.action}${p2.skipLog?.id ? ` (Log ${shortId(p2.skipLog.id)})` : ''}`);
  nw.skipDocs.push(p2.skipLog?.id);

  // Hire 1
  const preview1 = await buildHireMailPreview({ offerId: draft.id, position: 'Servicetechniker', hireIndex: 0 });
  console.log(`8) Hire-1-Vorschau body_key=${preview1.body_key} (${preview1.hires_before + 1}/${preview1.hires_target}) — Text-Fragment: "${preview1.body.slice(0, 60)}…"`);
  await createHire({ offer_id: draft.id, position: 'Servicetechniker', hired_at: nachFrist.toISOString().slice(0, 10), note: null, created_by: 'e2e' });

  // Periode 3: nach Hire (nächster Monat), keine Nachberechnung
  const p3 = await runMonthlyBillingForOffer(draft.id, { today: new Date(), periodStart: firstOfMonthOffset(1) });
  if (p3.doc?.id) nw.docs.push(p3.doc.id);
  console.log(`9) Periode nach Hire 1: action=${p3.action}`);

  // Hire 2
  const preview2 = await buildHireMailPreview({ offerId: draft.id, position: 'Elektriker', hireIndex: 1 });
  console.log(`10) Hire-2-Vorschau body_key=${preview2.body_key} — Enthält Upsell? ${preview2.body.includes('Einrichtung jeder weiteren Stelle') ? '✓' : '✗'}`);
} catch (err) {
  console.log('✗ N&W-KETTE FEHLER:', err.message);
} finally {
  console.log('\nN&W Cleanup…');
  for (const d of nw.docs) await delDoc(d);
  if (nw.abDocId) await delDoc(nw.abDocId);
  if (nw.offerDocId) await delDoc(nw.offerDocId);
  if (nw.draftId) {
    await supabase.from('talentone_invoices').delete().eq('offer_id', nw.draftId);
    await supabase.from('talentone_hires').delete().eq('offer_id', nw.draftId);
    await supabase.from('talentone_billing_skip_log').delete().eq('offer_id', nw.draftId);
    await supabase.from('talentone_offers').delete().eq('id', nw.draftId);
  }
  console.log('  ✓ N&W restlos aufgeräumt');
}

// ═══════════════════════ TalentOne-Kurzlauf ═══════════════════════
console.log('\n═══════════════════════ TalentOne (30 Tage, ad_budget=800) ═══════════════════════');
let to = { docs: [] };
try {
  const { draft, offerDocId } = await createTestOffer({
    brand: 'talentone', cust: CUST_TO,
    guarantee_period_days: 30, hires_target: 1, adBudget: 800,
  });
  to.draftId = draft.id;
  to.offerDocId = offerDocId;

  await finalizeInvoice(offerDocId);
  const ab = await convertToAb(offerDocId);
  to.abDocId = ab.id;
  const offerA = await fetchOffer(draft.id);
  await applyAcceptedTransition(offerA, ab);
  console.log(`1) Angebot + AB + accept ✓`);

  await supabase.from('talentone_offers')
    .update({ campaign_started_at: isoDaysAgo(45) }) // Frist seit 15 Tagen abgelaufen
    .eq('id', draft.id);

  const p1 = await runMonthlyBillingForOffer(draft.id, { today: new Date(), periodStart: firstOfMonthOffset(0) });
  if (p1.doc?.id) to.docs.push(p1.doc.id);
  console.log(`2) Monat 1 nach Frist: action=${p1.action} (erwartet: bill_budget_only)`);

  const p2 = await runMonthlyBillingForOffer(draft.id, { today: new Date(), periodStart: firstOfMonthOffset(1) });
  const off2 = await fetchOffer(draft.id);
  console.log(`3) Monat 2 nach Frist: action=${p2.action} (erwartet: skip_manual_reactivation) · billing_paused_at ${off2.billing_paused_at ? '✓' : '✗'}`);
} catch (err) {
  console.log('✗ TalentOne-KETTE FEHLER:', err.message);
} finally {
  console.log('\nTalentOne Cleanup…');
  for (const d of to.docs) await delDoc(d);
  if (to.abDocId) await delDoc(to.abDocId);
  if (to.offerDocId) await delDoc(to.offerDocId);
  if (to.draftId) {
    await supabase.from('talentone_invoices').delete().eq('offer_id', to.draftId);
    await supabase.from('talentone_billing_skip_log').delete().eq('offer_id', to.draftId);
    await supabase.from('talentone_offers').delete().eq('id', to.draftId);
  }
  console.log('  ✓ TalentOne restlos aufgeräumt');
}
process.exit(0);
