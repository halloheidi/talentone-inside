// Reine Berechnungslogik für Angebots-Summen.
// Wird sowohl von /api/offers/calculate (Wizard-Live-Vorschau) als auch von
// der easybill-Erzeugung in Phase 3 aufgerufen — damit Frontend und easybill
// garantiert dieselben Zahlen sehen.
//
// Vertrag:
//   Eingabe: - Positionskatalog (products) der jeweiligen Marke, aktive
//              Zeilen mit unit_price, category
//            - selectedItems: Array<{ product_id, quantity? }>
//              quantity default 1 (nur "extra job"-Optionen erlauben > 1)
//            - additional_positions_count (int) — Menge für die
//              "extra job"-Option; überschreibt die quantity in selectedItems
//              wenn > 0
//            - ad_budget_monthly (number|null) — nur TalentOne
//            - vat_rate (number) — z.B. 19
//   Ausgabe: { setup_total, monthly_total, first_month_total, ad_budget_monthly,
//              vat, gross, positions: [{ product_id, sku, title, category, unit_price,
//              quantity, line_total }] }
//
// Zahlen sind netto in Euro (nicht Cent — passt zu numeric(12,2) in der DB).

const SETUP_CATEGORIES   = new Set(['setup', 'option_setup']);
const MONTHLY_CATEGORIES = new Set(['monthly', 'option_monthly']);

/**
 * Werbebudget-Regel (nur TalentOne): min 300, max 5000, 50-€-Schritte.
 * Null / 0 sind explizit erlaubt (Kunde wählt Werbebudget später).
 */
export function validateAdBudget(amount) {
  if (amount == null || amount === '') return { ok: true };
  const n = Number(amount);
  if (!Number.isFinite(n)) return { ok: false, error: 'Werbebudget ist keine gültige Zahl.' };
  if (n === 0) return { ok: true };
  if (n < 300)  return { ok: false, error: 'Werbebudget muss mindestens 300 € betragen.' };
  if (n > 5000) return { ok: false, error: 'Werbebudget darf höchstens 5.000 € betragen.' };
  if (n % 50 !== 0) return { ok: false, error: 'Werbebudget muss ein Vielfaches von 50 € sein.' };
  return { ok: true };
}

/**
 * @typedef {{id:string, sku:string, title:string, category:'setup'|'monthly'|'option_setup'|'option_monthly', unit_price:number|string, active?:boolean}} Product
 * @typedef {{product_id:string, quantity?:number}} Selected
 *
 * @param {object} input
 * @param {Product[]} input.products
 * @param {Selected[]} input.selected
 * @param {number} [input.additional_positions_count=0]
 * @param {number|null} [input.ad_budget_monthly=null]
 * @param {number} [input.vat_rate=19]
 * @param {string} [input.extra_job_sku] — SKU der "weitere Stelle"-Option; damit
 *   wir sie unabhängig von der SKU-Konvention identifizieren können.
 */
export function calculateOfferTotals({
  products = [],
  selected = [],
  additional_positions_count = 0,
  ad_budget_monthly = null,
  vat_rate = 19,
  extra_job_sku = null,           // Legacy: einzelne SKU (behalten für Backwards-Compat)
  extra_job_skus = null,          // Neuer Kontrakt: Menge > 1 zulässig für ALLE SKUs in diesem Set
} = {}) {
  // Vereinheitlicht in ein Set. Legacy-Wert wird beigemischt, damit alte
  // Aufrufer weiter funktionieren.
  const extraSet = new Set(
    (Array.isArray(extra_job_skus) ? extra_job_skus : [])
      .concat(extra_job_sku ? [extra_job_sku] : [])
      .filter(Boolean)
  );
  const priceOf = p => Number(p.unit_price) || 0;
  const byId = new Map(products.map(p => [p.id, p]));

  const lines = [];
  const seen = new Set();

  for (const item of selected) {
    if (!item?.product_id) continue;
    if (seen.has(item.product_id)) continue;
    seen.add(item.product_id);

    const p = byId.get(item.product_id);
    if (!p) continue;
    if (p.active === false) continue;

    // Kontrakt: quantity>1 ist ausschließlich für die Extra-Job-Positionen
    // erlaubt (Extra-Job-Setup + Extra-Job-Monthly, gekoppelt an
    // additional_positions_count). Für alle anderen Positionen fixieren wir
    // quantity=1, damit Manipulationen im Frontend die Summen nicht verzerren.
    const isExtraJob = extraSet.has(p.sku);
    let quantity = 1;
    if (isExtraJob) {
      if (additional_positions_count > 0) {
        quantity = Math.floor(additional_positions_count);
      } else if (Number.isFinite(+item.quantity) && +item.quantity > 0) {
        quantity = Math.floor(+item.quantity);
      }
    }

    const line_total = round2(priceOf(p) * quantity);
    lines.push({
      product_id: p.id,
      sku:        p.sku,
      title:      p.title,
      category:   p.category,
      unit_price: priceOf(p),
      quantity,
      line_total,
    });
  }

  const setup_total = round2(
    lines.filter(l => SETUP_CATEGORIES.has(l.category))
         .reduce((sum, l) => sum + l.line_total, 0)
  );
  const monthly_total_service = round2(
    lines.filter(l => MONTHLY_CATEGORIES.has(l.category))
         .reduce((sum, l) => sum + l.line_total, 0)
  );

  const adBudget = Number.isFinite(+ad_budget_monthly) && +ad_budget_monthly > 0
    ? round2(+ad_budget_monthly)
    : 0;

  // monthly_total = die wiederkehrende Service-Rate OHNE Werbebudget-Durchleitung.
  // first_month_total = Setup + 1. Monat (Service) + (nur TalentOne) Werbebudget.
  const monthly_total = monthly_total_service;
  const first_month_total = round2(setup_total + monthly_total_service + adBudget);

  const vatFactor = Number(vat_rate) / 100;
  return {
    positions: lines,
    setup_total,
    monthly_total,
    monthly_total_service,
    ad_budget_monthly: adBudget,
    first_month_total,
    vat_rate: Number(vat_rate),
    vat: {
      setup_vat:       round2(setup_total * vatFactor),
      monthly_vat:     round2(monthly_total_service * vatFactor),
      ad_budget_vat:   round2(adBudget * vatFactor),
      first_month_vat: round2(first_month_total * vatFactor),
    },
    gross: {
      setup_gross:       round2(setup_total * (1 + vatFactor)),
      monthly_gross:     round2(monthly_total_service * (1 + vatFactor)),
      ad_budget_gross:   round2(adBudget * (1 + vatFactor)),
      first_month_gross: round2(first_month_total * (1 + vatFactor)),
    },
  };
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Werbebudget-Historie: bestimmt den zur Periode gültigen Betrag.
 *
 * Regel: der zuletzt gültig gewordene History-Eintrag mit
 *        effective_from ≤ periodStartIso gewinnt. Gibt es keinen,
 *        fällt es auf offer.ad_budget_monthly zurück (Ausgangs-Betrag aus
 *        dem Angebot).
 *
 * Pure Funktion — Historie wird vom Aufrufer geladen. Nutzt lexikografischen
 * String-Vergleich, funktioniert also nur für ISO-Datums-Strings (YYYY-MM-DD).
 *
 * @param {{brand:string, ad_budget_monthly:number|string|null}} offer
 * @param {Array<{new_amount:number|string, effective_from:string}>} historyRows
 * @param {string} periodStartIso   YYYY-MM-DD
 */
export function getEffectiveAdBudget(offer, historyRows = [], periodStartIso) {
  if (!offer || offer.brand !== 'talentone') return 0;
  const relevant = (historyRows || [])
    .filter(r => r.effective_from && r.effective_from <= periodStartIso)
    .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1));
  if (relevant.length > 0) return Number(relevant[0].new_amount) || 0;
  return Number(offer.ad_budget_monthly) || 0;
}
