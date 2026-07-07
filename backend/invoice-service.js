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
import { evaluateMonthlyBilling } from './billing-rules.js';
import { getEffectiveAdBudget } from './offer-calc.js';

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
/**
 * Reine Helper-Funktion: welche ref_ids soll der Setup-Rechnungs-Dup-Check in
 * easybill abfragen? Beide Wege müssen greifen — Angebots-Doc-ID (klassisch)
 * und AB-Doc-ID (Direkt-AB, wenn kein Angebot existiert).
 */
export function collectSetupDupRefIds(offer) {
  return [offer?.easybill_document_id, offer?.easybill_order_document_id]
    .filter(Boolean);
}

export async function findExistingInvoiceForOffer(offer) {
  // Zwei Fälle:
  //   a) Klassisch: Angebot → INVOICE (ref_id = Angebots-Doc-ID)
  //   b) Direkt-AB: Auftragsbestätigung → INVOICE (ref_id = AB-Doc-ID)
  // In beiden Fällen darf keine zweite Setup-Rechnung angelegt werden.
  const refIds = collectSetupDupRefIds(offer);
  if (refIds.length === 0) return null;

  const all = [];
  for (const refId of refIds) {
    const invoices = await listDocumentsByRefId({
      refId, types: ['INVOICE'], limit: 20,
    }).catch(() => []);
    all.push(...invoices);
  }
  if (!all.length) return null;

  const doc = all.sort((a, b) => Number(a.id) - Number(b.id))[0];
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
      pos: pos++, titleWithSuffix: 'Werbebudget-Abwicklung (Vorauszahlung)',
      description: 'Vollständige Abwicklung Ihres Werbebudgets über TalentOne — eine Rechnung, keine separaten Meta-Rechnungen. Wird monatlich im Voraus abgerechnet.',
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

// getEffectiveAdBudget lebt in offer-calc.js (rein-funktional, ohne DB).
// Re-Export für bestehende Aufrufer.
export { getEffectiveAdBudget };

async function loadAdBudgetHistory(offerId) {
  const { data } = await supabase
    .from('talentone_ad_budget_history')
    .select('new_amount, effective_from')
    .eq('offer_id', offerId);
  return data || [];
}

/**
 * Aktiviert die monatliche Abrechnung — setzt campaign_started_at (den Anker
 * der Garantie-Frist). KEIN easybill-RECURRING mehr — der eigene Cron
 * evaluiert monatlich die Abrechnungsregel und erzeugt Einzel-INVOICEs.
 *
 * @param {string} offerId
 * @param {object} [opts]
 * @param {string} [opts.startDate]  YYYY-MM-DD (default heute)
 */
export async function activateMonthlyBilling(offerId, { startDate = null } = {}) {
  const offer = await fetchOffer(offerId);
  if (offer.status !== 'accepted') throw new Error('Nur angenommene Angebote können abgerechnet werden.');
  if (offer.campaign_started_at)   throw new Error('Monatliche Abrechnung ist bereits aktiviert.');
  if (offer.billing_ended_at)      throw new Error('Monatliche Abrechnung wurde bereits beendet — neu aufsetzen erforderlich.');

  const products = await fetchCatalog(offer.brand);
  const items = buildRecurringItems({
    brand: offer.brand,
    products,
    selected: Array.isArray(offer.selected_product_ids) ? offer.selected_product_ids : [],
    adBudget: Number(offer.ad_budget_monthly) || 0,
  });
  if (!items.length) throw new Error('Keine monatlichen Positionen im Angebot.');

  const startIso = startDate || isoDate();
  const { data: updated, error } = await supabase.from('talentone_offers')
    .update({ campaign_started_at: startIso, last_synced_at: new Date().toISOString() })
    .eq('id', offerId).select().single();
  if (error) throw new Error(error.message);
  return { offer: updated, campaignStartedAt: startIso };
}

/** Beendet die monatliche Abrechnung — auch während der servicefreien Phase. */
export async function stopMonthlyBilling(offerId) {
  const offer = await fetchOffer(offerId);
  if (!offer.campaign_started_at) throw new Error('Monatliche Abrechnung war nicht aktiv.');
  if (offer.billing_ended_at)     throw new Error('Bereits beendet.');
  const { data, error } = await supabase.from('talentone_offers')
    .update({
      billing_ended_at: new Date().toISOString(),
      billing_paused_at: null,
      billing_pause_reason: null,
    })
    .eq('id', offerId).select().single();
  if (error) throw new Error(error.message);
  return { offer: data };
}

/**
 * Reaktivierung nach TalentOne max-servicefrei-Monat (manuelle Team-Entscheidung).
 * Nur der User kann das anstoßen — kein Automatismus.
 */
export async function reactivateMonthlyBilling(offerId, { note = null } = {}) {
  const offer = await fetchOffer(offerId);
  if (!offer.billing_paused_at) throw new Error('Abo ist nicht pausiert.');
  const { data, error } = await supabase.from('talentone_offers')
    .update({ billing_paused_at: null, billing_pause_reason: null })
    .eq('id', offerId).select().single();
  if (error) throw new Error(error.message);
  return { offer: data, note };
}

/**
 * Ändert das Werbebudget — schreibt History mit effective_from=nächster
 * Monatserster. Die aktuelle laufende Rechnungsperiode bleibt unberührt.
 *
 * Wichtig: offer.ad_budget_monthly wird NICHT mehr mutiert — dieser Wert ist
 * die "Kohorten-Baseline" (das ursprünglich vereinbarte Budget aus dem
 * Angebot). Der aktuelle effektive Betrag ergibt sich aus getEffectiveAdBudget
 * gegen die jeweilige Periode.
 */
export async function updateAdBudget(offerId, newAmount, { changedBy = null, reason = null } = {}) {
  const offer = await fetchOffer(offerId);
  if (offer.brand !== 'talentone') throw new Error('Werbebudget-Änderung ist nur für TalentOne relevant.');
  const cleanNew  = Number(newAmount) || 0;
  if (cleanNew < 0) throw new Error('Betrag muss ≥ 0 sein.');

  const history = await loadAdBudgetHistory(offerId);
  // Für die Anzeige/History: der bis dahin aktuell effektive Betrag
  const todayIso = isoDate();
  const oldAmount = getEffectiveAdBudget(offer, history, todayIso);
  const effFrom  = nextMonthFirst();

  await supabase.from('talentone_ad_budget_history').insert({
    offer_id: offerId, old_amount: oldAmount, new_amount: cleanNew,
    effective_from: effFrom, changed_by: changedBy, reason,
  });

  const { data } = await supabase.from('talentone_offers').select('*').eq('id', offerId).maybeSingle();
  return { offer: data, oldAmount, newAmount: cleanNew, effective_from: effFrom };
}

// ─────────────────────── Monatlicher Lauf pro Angebot ───────────────────────

function endOfMonth(dateIso) {
  const d = new Date(dateIso); d.setMonth(d.getMonth() + 1); d.setDate(0);
  return isoDate(d);
}
function firstOfMonth(dateIso) {
  const d = new Date(dateIso); d.setDate(1);
  return isoDate(d);
}
function formatMonthDE(dateIso) {
  const d = new Date(dateIso);
  return d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
}

/**
 * Zählt bereits protokollierte servicefreie Monate für dieses Angebot
 * (Basis für die TalentOne-max-1-Grenze).
 */
async function countServiceFreeMonths(offerId) {
  const { data } = await supabase
    .from('talentone_billing_skip_log')
    .select('id', { count: 'exact', head: false })
    .eq('offer_id', offerId)
    .in('reason', ['guarantee_no_hire']);
  return (data || []).length;
}

/**
 * Erzeugt (oder überspringt) den monatlichen Lauf für ein einzelnes Angebot.
 * Idempotent per UNIQUE(offer_id, period_start) im Skip-Log und talentone_invoices-
 * Row-Prüfung.
 *
 * @param {string} offerId
 * @param {object} [opts]
 * @param {Date}   [opts.today]        Rechnungslauf-Tag (default now)
 * @param {string} [opts.periodStart]  Serviceperiode (YYYY-MM-DD, default 1. Folgemonat)
 * @returns {Promise<{ action:string, invoice?:object, skipLog?:object }>}
 */
export async function runMonthlyBillingForOffer(offerId, { today = null, periodStart = null } = {}) {
  const offer = await fetchOffer(offerId);
  const runToday = today || new Date();
  const startIso = periodStart || nextMonthFirst(runToday);
  const endIso   = endOfMonth(startIso);

  // Duplikats-Guard: gibt es bereits einen Lauf für diese Periode?
  const { data: existingInv } = await supabase
    .from('talentone_invoices')
    .select('id, status')
    .eq('offer_id', offerId)
    .eq('period_start', startIso)
    .neq('status', 'cancelled')
    .maybeSingle();
  if (existingInv) return { action: 'already_billed', invoice: existingInv };

  const { data: existingSkip } = await supabase
    .from('talentone_billing_skip_log')
    .select('id')
    .eq('offer_id', offerId).eq('period_start', startIso).maybeSingle();
  if (existingSkip) return { action: 'already_logged', skipLog: existingSkip };

  const { count: hireCount } = await supabase
    .from('talentone_hires').select('id', { count: 'exact', head: true }).eq('offer_id', offerId);
  const hasHire = (hireCount || 0) > 0;
  const serviceFreeMonthsUsed = await countServiceFreeMonths(offerId);

  const decision = evaluateMonthlyBilling(offer, {
    today: runToday, hasHire, serviceFreeMonthsUsed,
  });

  const brandLabel = offer.brand === 'nowag_wirth' ? 'Nowag & Wirth' : 'TalentOne';
  const products = await fetchCatalog(offer.brand);
  const monthLabel = formatMonthDE(startIso);

  // Werbebudget-Historie: aus der Sicht der Periode startIso — nicht "heute".
  // Damit bekommt ein am 10. des Monats geänderter Betrag für die laufende
  // Periode noch den alten Wert, für die Folgeperiode den neuen.
  const budgetHistory = offer.brand === 'talentone' ? await loadAdBudgetHistory(offerId) : [];
  const effectiveAdBudget = getEffectiveAdBudget(offer, budgetHistory, startIso);

  const buildFullItems = () => buildRecurringItems({
    brand: offer.brand, products,
    selected: Array.isArray(offer.selected_product_ids) ? offer.selected_product_ids : [],
    adBudget: effectiveAdBudget,
  });
  const buildBudgetOnlyItems = () => {
    const items = [];
    if (effectiveAdBudget > 0) {
      items.push(makePosition({
        pos: 1,
        titleWithSuffix: `Werbebudget ${monthLabel} (Vorauszahlung)`,
        description: `Vollständige Abwicklung Ihres Werbebudgets über TalentOne für ${monthLabel}. Servicepauschale entfällt in diesem Monat gemäß Bewerbungsgarantie.`,
        quantity: 1, unitPriceEur: effectiveAdBudget, vatPercent: EUR_VAT_DEFAULT,
      }));
    }
    return items;
  };
  const waivedServiceAmount = Number(offer.monthly_total) || 0;

  // ─── Skip-Fälle ───
  if (decision.action.startsWith('skip_')) {
    // Bei TalentOne max_month_reached zusätzlich das Abo pausieren
    if (decision.action === 'skip_manual_reactivation') {
      await supabase.from('talentone_offers')
        .update({ billing_paused_at: new Date().toISOString(),
                  billing_pause_reason: 'talentone_max_month_reached' })
        .eq('id', offer.id);
    }
    const reasonMap = {
      skip_and_wait_first_hire:  'guarantee_no_hire',
      skip_manual_reactivation:  'talentone_max_month_reached',
      skip_service_waived:       'service_waived_override',
      skip_campaign_ended:       'campaign_ended',
      skip_billing_paused:       'talentone_max_month_reached',
    };
    const { data: skipLog } = await supabase.from('talentone_billing_skip_log').insert({
      offer_id: offer.id, brand: offer.brand,
      period_start: startIso, period_end: endIso,
      reason: reasonMap[decision.action] || 'other',
      waived_service_amount: waivedServiceAmount,
      budget_invoiced: false,
      note: decision.meta?.pause_reason || null,
    }).select().single();
    return { action: decision.action, skipLog };
  }

  // ─── bill_budget_only (TalentOne, servicefreier Monat mit Budget) ───
  if (decision.action === 'bill_budget_only') {
    const items = buildBudgetOnlyItems();
    if (!items.length) {
      // Kein Budget → nichts zu berechnen; Log als servicefrei + kein Budget
      const { data: skipLog } = await supabase.from('talentone_billing_skip_log').insert({
        offer_id: offer.id, brand: offer.brand,
        period_start: startIso, period_end: endIso,
        reason: 'guarantee_no_hire',
        waived_service_amount: waivedServiceAmount,
        budget_invoiced: false,
      }).select().single();
      return { action: 'skip_no_budget', skipLog };
    }
    const { invoice, doc } = await createMonthlyInvoiceInEasybill({
      offer, items, brandLabel, monthLabel,
      title: `Monatliche Rechnung ${monthLabel} — Werbebudget (servicefrei)`,
      documentText: `Ihre Werbebudget-Vorauszahlung für ${monthLabel}. Servicepauschale entfällt in diesem Monat gemäß Bewerbungsgarantie.`,
      invoiceType: 'ad_budget',
      periodStart: startIso, periodEnd: endIso,
    });
    await supabase.from('talentone_billing_skip_log').insert({
      offer_id: offer.id, brand: offer.brand,
      period_start: startIso, period_end: endIso,
      reason: 'guarantee_no_hire',
      waived_service_amount: waivedServiceAmount,
      budget_invoiced: true,
      invoice_id: invoice.id,
    });
    return { action: 'bill_budget_only', invoice, doc };
  }

  // ─── bill_full ───
  const items = buildFullItems();
  if (!items.length) return { action: 'skip_no_positions' };
  const { invoice, doc } = await createMonthlyInvoiceInEasybill({
    offer, items, brandLabel, monthLabel,
    title: `Monatliche Rechnung ${monthLabel} — ${brandLabel}`,
    documentText: `Ihre monatliche Betreuung für ${monthLabel}. Vielen Dank für die Zusammenarbeit.`,
    invoiceType: offer.brand === 'talentone' && Number(offer.ad_budget_monthly) > 0
      ? 'monthly_combined' : 'monthly_service',
    periodStart: startIso, periodEnd: endIso,
  });
  return { action: 'bill_full', invoice, doc };
}

/** Erzeugt eine talentone_invoices-Row + easybill-INVOICE. Nutzt keine
 *  Recurring-Vorlage — jede Rechnung ist ein eigenständiges Dokument. */
async function createMonthlyInvoiceInEasybill({
  offer, items, brandLabel, monthLabel, title, documentText,
  invoiceType, periodStart, periodEnd,
}) {
  const totalNet = round2(
    items.reduce((sum, it) => sum + ((Number(it.single_price_net) / 100) * (Number(it.quantity) || 1)), 0)
  );
  const totalGross = round2(totalNet * (1 + EUR_VAT_DEFAULT / 100));

  const { data: draft, error } = await supabase.from('talentone_invoices').insert({
    offer_id: offer.id,
    customer_id: offer.customer_id,
    easybill_customer_id: offer.easybill_customer_id,
    brand: offer.brand,
    invoice_type: invoiceType,
    period_start: periodStart, period_end: periodEnd,
    amount_net: totalNet, amount_gross: totalGross, vat_rate: EUR_VAT_DEFAULT,
    payment_method: 'bank_transfer',
    status: 'draft',
    due_date: addDays(7),
  }).select().single();
  if (error) throw new Error(`talentone_invoices insert: ${error.message}`);

  const doc = await createInvoiceDocument({
    type: 'INVOICE',
    customerId: Number(offer.easybill_customer_id),
    title, items, text: documentText,
    pdfTemplate: getPdfTemplate(offer.brand, 'INVOICE'),
    externalId: draft.id,
  });

  const { data: updated } = await supabase.from('talentone_invoices').update({
    easybill_document_id: String(doc.id),
    easybill_pdf_url: `/api/invoices/${draft.id}/pdf`,
    status: 'sent',
    last_synced_at: new Date().toISOString(),
  }).eq('id', draft.id).select().single();

  return { invoice: updated, doc };
}

// ─────────────────────── Backwards-Compat (Alt-Namen) ───────────────────────
// Die frühere API (Phase 5 pre-Nachtrag) nutzte activateMonthlyRecurring /
// stopMonthlyRecurring. Wir re-exportieren die neuen Funktionen unter den
// alten Namen für Wire-Kompatibilität. Diese sollten nicht mehr genutzt
// werden — nutzt stattdessen activateMonthlyBilling / stopMonthlyBilling.
export const activateMonthlyRecurring = activateMonthlyBilling;
export const stopMonthlyRecurring     = stopMonthlyBilling;
