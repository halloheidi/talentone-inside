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
// Extra-Job-Positionen je Marke: Setup + Monthly werden über EIN
// additional_positions_count gemeinsam gesteuert (quantity gekoppelt).
const EXTRA_JOB_SKUS_BY_BRAND = {
  talentone:   ['TO-OPT-EXTRA-JOB-SETUP', 'TO-OPT-EXTRA-JOB'],
  nowag_wirth: ['NW-OPT-EXTRA-JOB-SETUP', 'NW-OPT-EXTRA-JOB'],
};

export const AD_BUDGET_TITLE = 'Werbebudget-Abwicklung (Vorauszahlung)';
export const AD_BUDGET_DESCRIPTION =
  'Vollständige Abwicklung Ihres Werbebudgets über TalentOne — eine Rechnung, keine separaten Meta-Rechnungen. Kampagnenstart nach Zahlungseingang.';

// easybill: single_price_net erwartet Cent, obwohl der Typ float ist
// (siehe Spec: "150 = 1.50€"). Wir speichern Euro in der DB und wandeln
// hier einmalig zentral um.
function euroToCents(euro) {
  return Math.round(Number(euro || 0) * 100);
}

// Fallback-Labels, falls in talentone_offer_templates kein passender
// Key gepflegt ist. Bevorzugt wird der Template-Key (siehe unten).
const DEFAULT_GUARANTEE_LABEL_BY_BRAND = {
  talentone:   'Bewerbungsgarantie',
  nowag_wirth: 'Erfolgsgarantie',
};

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
  discount_type = null,
  discount_value = 0,
  guarantee_type = null,
  guarantee_period_days = 0,
  guarantee_applications_count = null,
  guarantee_note = null,
} = {}) {
  const extraSkus = EXTRA_JOB_SKUS_BY_BRAND[brand] || [];

  // Erst: durch den Rechner laufen lassen, damit wir konsistente
  // Mengen/Beträge haben — genau die Zahlen, die auf dem PDF stehen sollen.
  const totals = calculateOfferTotals({
    products, selected,
    additional_positions_count,
    ad_budget_monthly,
    vat_rate,
    extra_job_skus: extraSkus,
    discount_type,
    discount_value,
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

  // Rabatt (falls gesetzt): negative Setup-Position, wird auf Setup verrechnet.
  if (totals.discount_amount > 0) {
    const rabattTitel = totals.discount_type === 'percent'
      ? `Rabatt (${totals.discount_value}% auf Setup)`
      : 'Rabatt (Einmalig)';
    items.push(makePosition({
      pos: pos++,
      titleWithSuffix: rabattTitel,
      description: null,
      quantity: 1,
      unit_price: -Math.abs(totals.discount_amount),
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
  // Garantie-Position NUR, wenn eine Garantie gewaehlt wurde. Frueher wurde sie
  // gerendert, sobald ein guarantee-Template existierte (schlug auch bei "keine
  // Garantie" durch) — das ist der Bug, den wir hier schliessen.
  // Rueckwaerts-kompatibel: fehlt guarantee_type, an guarantee_period_days koppeln.
  const guaranteeAktiv = guarantee_type
    ? guarantee_type !== 'none'
    : Number(guarantee_period_days) > 0;
  let guarantee = null;
  if (guaranteeAktiv) {
    // Text: gepflegter Note-Text > generierter Default je Art.
    guarantee = (guarantee_note && guarantee_note.trim()) || null;
    if (!guarantee) {
      guarantee = guarantee_type === 'applications'
        ? `Wir garantieren mindestens ${guarantee_applications_count || 0} Bewerbungen fuer die ausgeschriebene Stelle innerhalb der Kampagnenlaufzeit. Werden weniger erreicht, arbeiten wir ohne weitere Servicegebuehr weiter, bis die zugesagte Anzahl erreicht ist.`
        : findTemplate(templates, 'guarantee'); // hire -> Template
    }
    if (guarantee) {
      // Platzhalter fuellen (bisher blieb {{garantie_frist}} leer -> "nach Tagen").
      guarantee = String(guarantee)
        .replace(/\{\{\s*garantie_frist\s*\}\}/gi, String(Number(guarantee_period_days) || 0))
        .replace(/\{\{\s*bewerbungen\s*\}\}/gi, String(guarantee_applications_count || 0));
    }
  }
  const guaranteeLabel = findTemplate(templates, 'guarantee_label')
                       || DEFAULT_GUARANTEE_LABEL_BY_BRAND[brand]
                       || 'Garantie';
  const paymentTerms   = findTemplate(templates, 'payment_terms');
  if (guarantee)    items.push(makeTextPosition({ pos: pos++, title: guaranteeLabel,      body: guarantee }));
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
    // easybill erwartet Cent — unit_price kommt aus der DB in Euro.
    single_price_net: euroToCents(unit_price),
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

