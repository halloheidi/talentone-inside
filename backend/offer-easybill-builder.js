// Baut aus einem gespeicherten Angebot + Katalog + Textbausteine
// das easybill-Dokument-Payload (items[] + optional text am Ende).
//
// Reihenfolge der Positionen (per position=1..N):
//   1..N  Setup-Positionen        (POSITION, quantity=1)
//   +     Setup-Optionen (falls gewählt)
//   +     Monatliche Positionen   — Titel bekommt "(monatlich)"-Suffix
//   +     Monatliche Optionen (falls gewählt) — inkl. Extra-Job mit Menge
//   +     (nur TalentOne) Werbebudget-Sonderposten (POSITION, monatlich)
//   +     Garantie                (TEXT, ohne Preis)
//   +     Zahlungsbedingungen     (TEXT, ohne Preis)
//
// Positionstitel + Volltext werden per "\n\n" in ein einziges `description`-
// Feld gepackt (easybill kennt kein separates title-Feld pro Position).

import { calculateOfferTotals } from './offer-calc.js';

const SETUP_CATS   = new Set(['setup', 'option_setup']);
const MONTHLY_CATS = new Set(['monthly', 'option_monthly']);
const EXTRA_JOB_SKU_BY_BRAND = { talentone: 'TO-OPT-EXTRA-JOB', nowag_wirth: 'NW-OPT-EXTRA-JOB' };

const AD_BUDGET_TITLE = 'Werbebudget-Abwicklung (monatlich im Voraus)';
const AD_BUDGET_DESCRIPTION =
  'Vollständige Abwicklung Ihres Werbebudgets über TalentOne — eine Rechnung, keine separaten Meta-Rechnungen. Kampagnenstart nach Zahlungseingang.';

/**
 * @param {object} input
 * @param {'talentone'|'nowag_wirth'} input.brand
 * @param {Array} input.products              — aktive Positionen der Marke
 * @param {Array} input.selected              — [{ product_id, quantity? }]
 * @param {number} input.additional_positions_count
 * @param {number|null} input.ad_budget_monthly
 * @param {number} input.vat_rate
 * @param {Array<{key:string,text:string}>} input.templates — offer_templates der Marke
 * @returns {{ items:Array, text:string|null, totals:object }}
 */
export function buildEasybillOfferPayload({
  brand,
  products = [],
  selected = [],
  additional_positions_count = 0,
  ad_budget_monthly = null,
  vat_rate = 19,
  templates = [],
} = {}) {
  const extraSku = EXTRA_JOB_SKU_BY_BRAND[brand] || null;

  // Erst: durch den Rechner laufen lassen, damit wir konsistente
  // Mengen/Beträge haben — genau die Zahlen, die auf dem PDF stehen sollen.
  const totals = calculateOfferTotals({
    products, selected,
    additional_positions_count,
    ad_budget_monthly,
    vat_rate,
    extra_job_sku: extraSku,
  });

  const productById = new Map(products.map(p => [p.id, p]));
  const isSetup   = l => SETUP_CATS.has(l.category);
  const isMonthly = l => MONTHLY_CATS.has(l.category);

  const setupLines   = totals.positions.filter(isSetup);
  const monthlyLines = totals.positions.filter(isMonthly);

  const items = [];
  let pos = 1;

  // Setup zuerst (Reihenfolge nach sort_order)
  setupLines.sort(sortByCatalogOrder(productById));
  for (const l of setupLines) {
    const p = productById.get(l.product_id);
    items.push(makePosition({
      pos: pos++,
      titleWithSuffix: p.title, // Setup: kein Suffix
      description: p.description,
      quantity: l.quantity,
      unit_price: l.unit_price,
      vat_percent: vat_rate,
    }));
  }

  // Monatlich als Nächstes, mit "(monatlich)"-Suffix
  monthlyLines.sort(sortByCatalogOrder(productById));
  for (const l of monthlyLines) {
    const p = productById.get(l.product_id);
    items.push(makePosition({
      pos: pos++,
      titleWithSuffix: `${p.title} (monatlich)`,
      description: p.description,
      quantity: l.quantity,
      unit_price: l.unit_price,
      vat_percent: vat_rate,
    }));
  }

  // Werbebudget-Sonderposten (nur TalentOne)
  if (brand === 'talentone' && totals.ad_budget_monthly > 0) {
    items.push(makePosition({
      pos: pos++,
      titleWithSuffix: `${AD_BUDGET_TITLE}`,
      description: AD_BUDGET_DESCRIPTION,
      quantity: 1,
      unit_price: totals.ad_budget_monthly,
      vat_percent: vat_rate,
    }));
  }

  // Schlusstexte als eigene TEXT-Positionen (kein Preis)
  const guarantee    = findTemplate(templates, 'guarantee');
  const paymentTerms = findTemplate(templates, 'payment_terms');
  if (guarantee) items.push(makeTextPosition({ pos: pos++, title: 'Bewerbungsgarantie', body: guarantee }));
  if (paymentTerms) items.push(makeTextPosition({ pos: pos++, title: 'Zahlungsbedingungen', body: paymentTerms }));

  return { items, text: null, totals };
}

function sortByCatalogOrder(productById) {
  return (a, b) => {
    const pa = productById.get(a.product_id) || {};
    const pb = productById.get(b.product_id) || {};
    return (pa.sort_order || 0) - (pb.sort_order || 0);
  };
}

function findTemplate(templates, key) {
  const t = templates.find(x => x.key === key);
  const s = (t?.text || '').trim();
  return s || null;
}

/**
 * DocumentPosition (Standard, type=POSITION).
 * easybill hat kein separates title-Feld — Titel wird als erste Zeile in
 * description gesetzt, danach eine Leerzeile, danach der Volltext.
 */
function makePosition({ pos, titleWithSuffix, description, quantity, unit_price, vat_percent }) {
  const desc = description && description.trim()
    ? `${titleWithSuffix}\n\n${description.trim()}`
    : titleWithSuffix;
  return {
    type: 'POSITION',
    position: pos,
    description: desc,
    quantity: Number(quantity) || 1,
    unit: 'Stk.',
    single_price_net: round2(Number(unit_price) || 0),
    vat_percent: Number(vat_percent) || 19,
  };
}

/**
 * Text-Position ohne Preis (für Garantie/Zahlungsbedingungen).
 * type='TEXT' → easybill rendert das als Fließtext-Block in der Position-Tabelle.
 */
function makeTextPosition({ pos, title, body }) {
  const description = title ? `${title}\n\n${body}` : body;
  return {
    type: 'TEXT',
    position: pos,
    description,
  };
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}
