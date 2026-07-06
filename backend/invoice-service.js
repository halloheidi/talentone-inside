// Abrechnungs-Workflow (Phase 5) — Setup-Rechnung, monatliches Abo
// (via easybill RECURRING), Werbebudget-Änderungen, Beenden.
//
// Semantik:
//   - Setup-Rechnung: einmalige INVOICE mit allen Setup-Positionen des
//     angenommenen Angebots. Vor Erzeugung Dup-Check: existiert bereits
//     eine easybill-INVOICE mit ref_id auf das Angebot, wird sie verlinkt.
//   - Monatliches Abo: RECURRING-Doc in easybill (frequency MONTHLY,
//     target_type INVOICE) — easybill generiert die tatsächlichen Rechnungen
//     automatisch. Positionen: Service-Pauschale + (TalentOne) Werbebudget.
//   - Werbebudget-Update: PUT auf RECURRING-Doc + History-Row.
//   - Beenden: RECURRING-Status auf STOP + billing_ended_at.
//
// Idempotenz: Duplikats-Prüfungen an jedem Schritt (bestehendes offer_id +
// invoice_type → nichts anlegen).

import { supabase } from './supabase.js';
import {
  createInvoiceDocument, listDocumentsByRefId, updateDocument, getDocument,
} from './easybill.js';
import { getPdfTemplate } from './easybill-templates.js';
import { createInvoice as paypalCreateInvoice } from './paypal.js';

const EUR_VAT_DEFAULT = 19;

// ─────────────────────── Helpers ───────────────────────
function euroToCents(e) { return Math.round(Number(e || 0) * 100); }
function round2(v)      { return Math.round(Number(v) * 100) / 100; }
function isoDate(d = new Date()) { return d.toISOString().slice(0, 10); }
function addDays(days, from = new Date()) {
  const d = new Date(from); d.setDate(d.getDate() + days);
  return isoDate(d);
}

async function fetchOffer(offerId) {
  const { data, error } = await supabase.from('talentone_offers').select('*').eq('id', offerId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Angebot nicht gefunden.');
  return data;
}

async function fetchKunde(customerId) {
  if (!customerId) return null;
  const { data } = await supabase.from('talentone_kunden').select('*').eq('id', customerId).maybeSingle();
  return data || null;
}

async function fetchCatalog(brand) {
  const { data } = await supabase
    .from('talentone_offer_products')
    .select('*').eq('brand', brand).eq('active', true);
  return data || [];
}

// Titel + Volltext wie im Angebots-Builder (title\n\ndescription).
function makePosition({ pos, titleWithSuffix, description, quantity, unitPriceEur, vatPercent }) {
  const desc = description && description.trim()
    ? `${titleWithSuffix}\n\n${description.trim()}`
    : titleWithSuffix;
  return {
    type: 'POSITION', position: pos, description: desc,
    quantity: Number(quantity) || 1, unit: 'Stk.',
    single_price_net: euroToCents(unitPriceEur),
    vat_percent: Number(vatPercent) || EUR_VAT_DEFAULT,
  };
}

// ─────────────────────── Duplikats-Prüfung ───────────────────────

/**
 * Sucht in easybill nach INVOICEs, deren ref_id auf das Angebots-Dokument
 * zeigt — Direkt-INVOICE-Fall (Angebot wurde ohne Auftragsbestätigung
 * direkt fakturiert). Wenn eine gefunden wird, wird sie verlinkt statt
 * eine zweite Setup-Rechnung anzulegen.
 *
 * @returns {Promise<{ easybillDocId, doc } | null>}
 */
export async function findExistingInvoiceForOffer(offer) {
  if (!offer?.easybill_document_id) return null;
  const invoices = await listDocumentsByRefId({
    refId: offer.easybill_document_id,
    types: ['INVOICE'],
    limit: 20,
  }).catch(() => []);
  if (!invoices.length) return null;
  // Nimm die erste — wenn easybill mehrere angelegt hat, ist die älteste die
  // "eigentliche" Setup-Rechnung.
  const doc = invoices.sort((a, b) => Number(a.id) - Number(b.id))[0];
  return { easybillDocId: String(doc.id), doc };
}

/**
 * Prüft, ob in talentone_invoices bereits eine Setup-Rechnung für dieses
 * Angebot existiert (unabhängig von easybill).
 */
async function existingSetupInvoiceRow(offerId) {
  const { data } = await supabase
    .from('talentone_invoices')
    .select('*')
    .eq('offer_id', offerId)
    .eq('invoice_type', 'setup')
    .neq('status', 'cancelled')
    .maybeSingle();
  return data || null;
}

// ─────────────────────── Setup-Rechnung ───────────────────────
/**
 * Erstellt (oder verlinkt) die Setup-Rechnung für ein angenommenes Angebot.
 * Aufrufer: POST /api/invoices/setup { offer_id }.
 *
 * @param {string} offerId
 * @param {object} [opts]
 * @param {string} [opts.createdBy]
 * @param {boolean} [opts.usePaypal] — überschreibt kunde.paypal_enabled
 */
export async function createSetupInvoice(offerId, { createdBy = null, usePaypal = null } = {}) {
  const offer = await fetchOffer(offerId);
  if (offer.status !== 'accepted') {
    throw new Error(`Nur angenommene Angebote können abgerechnet werden (aktuell: ${offer.status}).`);
  }

  // 1. Duplikats-Prüfung intern
  const existingRow = await existingSetupInvoiceRow(offerId);
  if (existingRow) return { alreadyExists: true, invoice: existingRow, reason: 'row_exists' };

  // 2. Duplikats-Prüfung in easybill (Direkt-INVOICE-Fall)
  const inEasybill = await findExistingInvoiceForOffer(offer);
  if (inEasybill) {
    const rowFromExisting = await linkExistingEasybillInvoice(offer, inEasybill.doc, { createdBy });
    return { alreadyExists: true, invoice: rowFromExisting, reason: 'easybill_dup', doc: inEasybill.doc };
  }

  // 3. Neue Setup-INVOICE aus dem Katalog bauen
  const [products, kunde] = await Promise.all([
    fetchCatalog(offer.brand),
    fetchKunde(offer.customer_id),
  ]);
  const productsById = new Map(products.map(p => [p.id, p]));
  const setupCats = new Set(['setup', 'option_setup']);

  const selected = Array.isArray(offer.selected_product_ids) ? offer.selected_product_ids : [];
  const extraJobSkus = new Set([
    'TO-OPT-EXTRA-JOB-SETUP', 'NW-OPT-EXTRA-JOB-SETUP', // Setup-Positionen der Extra-Jobs
  ]);
  const addCount = Number(offer.additional_positions_count || 0);

  const items = [];
  let pos = 1;
  for (const s of selected) {
    const p = productsById.get(s.product_id);
    if (!p || !setupCats.has(p.category)) continue;
    const isExtra = extraJobSkus.has(p.sku);
    const quantity = isExtra && addCount > 0 ? addCount : 1;
    items.push(makePosition({
      pos: pos++,
      titleWithSuffix: p.title,
      description: p.description,
      quantity,
      unitPriceEur: Number(p.unit_price),
      vatPercent: EUR_VAT_DEFAULT,
    }));
  }
  if (!items.length) throw new Error('Keine Setup-Positionen im Angebot.');

  // PayPal-Zahlungsart entscheiden
  const paypalEnabled = usePaypal === null
    ? !!kunde?.paypal_enabled
    : !!usePaypal;

  const dueDate = addDays(7);
  const brandLabel = offer.brand === 'nowag_wirth' ? 'Nowag & Wirth' : 'TalentOne';

  // Amounts serverseitig berechnen (Netto-Summe der items)
  const totalNet = round2(
    items.reduce((sum, it) => sum + ((Number(it.single_price_net) / 100) * (Number(it.quantity) || 1)), 0)
  );
  const totalGross = round2(totalNet * (1 + EUR_VAT_DEFAULT / 100));

  // 4a. Draft-Row in talentone_invoices (damit wir eine invoice-Referenz für PayPal haben)
  const invoiceRefBase = `SETUP-${String(offerId).slice(0, 8)}`;
  const { data: draft, error: draftErr } = await supabase.from('talentone_invoices').insert({
    offer_id: offer.id,
    customer_id: offer.customer_id,
    easybill_customer_id: offer.easybill_customer_id,
    brand: offer.brand,
    invoice_type: 'setup',
    amount_net: totalNet,
    amount_gross: totalGross,
    vat_rate: EUR_VAT_DEFAULT,
    payment_method: paypalEnabled ? 'paypal' : 'bank_transfer',
    status: 'draft',
    due_date: dueDate,
    paypal_reference: invoiceRefBase,
  }).select().single();
  if (draftErr) throw new Error(`talentone_invoices insert: ${draftErr.message}`);

  // 4b. PayPal-Zahllink (optional)
  let paypalPayLink = null;
  if (paypalEnabled) {
    try {
      const cust = offer.customer_snapshot || {};
      const pp = await paypalCreateInvoice({
        amountCent:      Math.round(totalGross * 100),
        description:     `Setup ${brandLabel} — Angebot ${offer.id.slice(0, 8)}`,
        invoiceNumber:   draft.id.slice(0, 24), // fürs Matching im Webhook
        faelligkeit:     dueDate,
        customerEmail:   cust.email || null,
        customerName:    cust.company_name || null,
        noteToRecipient: `Setup-Rechnung ${brandLabel}`,
      });
      paypalPayLink = pp.pay_link;
      // Ref anpassen auf PayPal-Invoice-ID für sauberen Webhook-Match
      await supabase.from('talentone_invoices')
        .update({ paypal_pay_link: paypalPayLink, paypal_reference: pp.id })
        .eq('id', draft.id);
    } catch (err) {
      console.warn('[invoice-service setup paypal]', err.message);
      // PayPal-Fehler: wir machen mit bank_transfer weiter (der User kann später wechseln)
      await supabase.from('talentone_invoices')
        .update({ payment_method: 'bank_transfer' })
        .eq('id', draft.id);
    }
  }

  // 4c. easybill-INVOICE erzeugen — mit PayPal-Link im text (falls vorhanden)
  const paymentBlock = paypalPayLink
    ? `\n\nBequem online per PayPal zahlen: ${paypalPayLink}\n\nOder per Überweisung auf die unten angegebene Bankverbindung.`
    : '';
  const documentText = `Setup-Rechnung für Ihre Recruiting-Kampagne — vielen Dank für Ihr Vertrauen. Fälligkeit: 7 Tage nach Rechnungsstellung.${paymentBlock}`;

  let doc;
  try {
    doc = await createInvoiceDocument({
      type: 'INVOICE',
      customerId: Number(offer.easybill_customer_id),
      title: `Setup — ${brandLabel}`,
      items, text: documentText,
      pdfTemplate: getPdfTemplate(offer.brand, 'INVOICE'),
      externalId: draft.id,
    });
  } catch (err) {
    // easybill schlug fehl: Draft in talentone_invoices bleibt bestehen — der
    // User kann später erneut versuchen. Fehler weiterwerfen.
    throw new Error(`easybill: ${err.message}`);
  }

  // 4d. Fertigstellen
  const { data: updated, error: upErr } = await supabase
    .from('talentone_invoices')
    .update({
      easybill_document_id: String(doc.id),
      easybill_pdf_url: `/api/invoices/${draft.id}/pdf`,
      status: 'sent',
      last_synced_at: new Date().toISOString(),
    })
    .eq('id', draft.id).select().single();
  if (upErr) throw new Error(upErr.message);
  return { alreadyExists: false, invoice: updated, doc };
}

/**
 * Direkt-INVOICE-Fall: easybill hat bereits eine Rechnung mit ref_id auf
 * das Angebot. Wir verlinken sie in talentone_invoices statt neu anzulegen.
 */
async function linkExistingEasybillInvoice(offer, doc, { createdBy = null } = {}) {
  const amountNet = round2((Number(doc.amount_net) || 0) / 100);
  const amountGross = round2((Number(doc.amount) || 0) / 100);
  const { data, error } = await supabase.from('talentone_invoices').insert({
    offer_id: offer.id,
    customer_id: offer.customer_id,
    easybill_customer_id: offer.easybill_customer_id,
    brand: offer.brand,
    invoice_type: 'setup',
    amount_net: amountNet,
    amount_gross: amountGross,
    vat_rate: EUR_VAT_DEFAULT,
    payment_method: 'bank_transfer',
    status: doc.paid_at ? 'paid' : 'sent',
    paid_at: doc.paid_at ? new Date(doc.paid_at).toISOString() : null,
    easybill_document_id: String(doc.id),
    easybill_pdf_url: `/api/invoices/direct-link/${doc.id}/pdf`,
    last_synced_at: new Date().toISOString(),
  }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

// ─────────────────────── Monatliches Abo (RECURRING) ───────────────────────
/** Baut die Positionen fürs monatliche RECURRING-Doc. */
function buildRecurringItems({ brand, products, selected, adBudget }) {
  const byId = new Map(products.map(p => [p.id, p]));
  const items = [];
  let pos = 1;
  const monthlyCats = new Set(['monthly', 'option_monthly']);

  for (const s of selected) {
    const p = byId.get(s.product_id);
    if (!p || !monthlyCats.has(p.category)) continue;
    const isExtra = ['TO-OPT-EXTRA-JOB', 'NW-OPT-EXTRA-JOB'].includes(p.sku);
    const quantity = isExtra && s.quantity ? Number(s.quantity) : (Number(s.quantity) || 1);
    items.push(makePosition({
      pos: pos++, titleWithSuffix: `${p.title} (monatlich)`,
      description: p.description, quantity,
      unitPriceEur: Number(p.unit_price), vatPercent: EUR_VAT_DEFAULT,
    }));
  }
  if (brand === 'talentone' && adBudget > 0) {
    items.push(makePosition({
      pos: pos++, titleWithSuffix: 'Werbebudget-Abwicklung (monatlich im Voraus)',
      description: 'Vollständige Abwicklung Ihres Werbebudgets über TalentOne — eine Rechnung, keine separaten Meta-Rechnungen.',
      quantity: 1, unitPriceEur: adBudget, vatPercent: EUR_VAT_DEFAULT,
    }));
  }
  return items;
}

function nextMonthFirst(from = new Date()) {
  const d = new Date(from);
  d.setMonth(d.getMonth() + 1); d.setDate(1);
  return isoDate(d);
}

/**
 * Aktiviert das monatliche Abo — legt in easybill ein RECURRING-Doc an
 * (frequency MONTHLY, next_date = übergebenes Datum oder 1. des Folgemonats).
 */
export async function activateMonthlyRecurring(offerId, { startDate = null } = {}) {
  const offer = await fetchOffer(offerId);
  if (offer.status !== 'accepted') throw new Error('Nur angenommene Angebote können abgerechnet werden.');
  if (offer.easybill_recurring_document_id) {
    throw new Error('Monatliches Abo ist bereits aktiv.');
  }
  if (offer.billing_ended_at) {
    throw new Error('Monatliches Abo wurde bereits beendet — neu aufsetzen erforderlich.');
  }

  const products = await fetchCatalog(offer.brand);
  const items = buildRecurringItems({
    brand: offer.brand,
    products,
    selected: Array.isArray(offer.selected_product_ids) ? offer.selected_product_ids : [],
    adBudget: Number(offer.ad_budget_monthly) || 0,
  });
  if (!items.length) throw new Error('Keine monatlichen Positionen im Angebot.');

  const brandLabel = offer.brand === 'nowag_wirth' ? 'Nowag & Wirth' : 'TalentOne';
  const nextDate = startDate || nextMonthFirst();

  const doc = await createInvoiceDocument({
    type: 'RECURRING',
    customerId: Number(offer.easybill_customer_id),
    title: `Monatliches Abo — ${brandLabel}`,
    items,
    pdfTemplate: getPdfTemplate(offer.brand, 'INVOICE'),
    externalId: offer.id,
    recurringOptions: {
      next_date: nextDate, frequency: 'MONTHLY', interval: 1, status: 'RUNNING',
      target_type: 'INVOICE', send_as: 'EMAIL',
    },
    text: 'Ihre monatliche Servicepauschale — vielen Dank für die Zusammenarbeit.',
  });

  const { data: updated, error } = await supabase.from('talentone_offers')
    .update({ easybill_recurring_document_id: String(doc.id), last_synced_at: new Date().toISOString() })
    .eq('id', offerId).select().single();
  if (error) throw new Error(error.message);
  return { offer: updated, recurringDocId: doc.id, nextDate };
}

/** Beendet das monatliche Abo — Status STOP in easybill + billing_ended_at. */
export async function stopMonthlyRecurring(offerId) {
  const offer = await fetchOffer(offerId);
  if (!offer.easybill_recurring_document_id) throw new Error('Kein aktives Abo.');
  await updateDocument(offer.easybill_recurring_document_id, {
    recurring_options: { status: 'STOP', next_date: nextMonthFirst() },
  });
  const { data, error } = await supabase.from('talentone_offers')
    .update({ billing_ended_at: new Date().toISOString(), last_synced_at: new Date().toISOString() })
    .eq('id', offerId).select().single();
  if (error) throw new Error(error.message);
  return { offer: data };
}

/**
 * Ändert das Werbebudget — schreibt History, patched RECURRING-Doc,
 * Angebot.ad_budget_monthly aktualisiert.
 */
export async function updateAdBudget(offerId, newAmount, { changedBy = null, reason = null } = {}) {
  const offer = await fetchOffer(offerId);
  if (offer.brand !== 'talentone') throw new Error('Werbebudget-Änderung ist nur für TalentOne relevant.');
  const oldAmount = Number(offer.ad_budget_monthly) || 0;
  const cleanNew  = Number(newAmount) || 0;
  if (cleanNew < 0) throw new Error('Betrag muss ≥ 0 sein.');

  // History anlegen
  await supabase.from('talentone_ad_budget_history').insert({
    offer_id: offerId, old_amount: oldAmount, new_amount: cleanNew,
    effective_from: nextMonthFirst(), changed_by: changedBy, reason,
  });

  // Angebot aktualisieren (calculateOfferTotals arbeitet für Live-Ansichten
  // — die Historie stützt nur die Kampagne)
  await supabase.from('talentone_offers')
    .update({ ad_budget_monthly: cleanNew })
    .eq('id', offerId);

  // RECURRING-Doc-Positionen frisch aufbauen und in easybill patchen
  if (offer.easybill_recurring_document_id) {
    const products = await fetchCatalog(offer.brand);
    const items = buildRecurringItems({
      brand: offer.brand,
      products,
      selected: Array.isArray(offer.selected_product_ids) ? offer.selected_product_ids : [],
      adBudget: cleanNew,
    });
    await updateDocument(offer.easybill_recurring_document_id, { items });
  }

  const { data } = await supabase.from('talentone_offers').select('*').eq('id', offerId).maybeSingle();
  return { offer: data, oldAmount, newAmount: cleanNew };
}
