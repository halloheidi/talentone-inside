// Reiner Renderer für den {{eckdaten}}-Merge-Tag in Angebots- und
// Auftragsbestätigungs-Mails.
//
// Regel: Der Gesamtbetrag ist IMMER exakt die Summe der aufgelisteten Beträge.
// Struktur spiegelt die Gesprächsführung wider:
//   1. „Unsere Leistung" (Setup + Servicepauschale + gewählte monatliche
//      Optionen als eigene Zeilen)
//   2. Werbebudget-Absatz — TalentOne mit Betrag, Nowag & Wirth als Hinweis
//   3. Gesamtbetrag Monat 1

// Beträge einheitlich de-DE mit zwei Nachkommastellen ("1.000,00 €").
const EUR_FMT = new Intl.NumberFormat('de-DE', {
  style: 'currency', currency: 'EUR',
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
function fmtEur(n) { return EUR_FMT.format(Number(n) || 0); }

// Zentrale Servicepauschale je Marke — dieselben SKUs, mit denen die Kampagne
// abgerechnet wird.
const SERVICE_PAUSCHALE_SKUS = new Set([
  'TO-MONTHLY-CAMPAIGN',
  'NW-MONTHLY-CAMPAIGN',
]);

const SETUP_CATEGORIES   = new Set(['setup', 'option_setup']);
const MONTHLY_CATEGORIES = new Set(['monthly', 'option_monthly']);

/**
 * Baut den Eckdaten-Text als reinen String (multiline, mit \n).
 * Mail-Templates setzen {{eckdaten}} vor die Grußformel — der Text formatiert
 * sich also selbst als Absätze.
 *
 * @param {object} input
 * @param {'talentone'|'nowag_wirth'} input.brand
 * @param {Array<{sku:string,title:string,category:string,quantity:number,line_total:number}>} input.positions
 * @param {number} input.setup_total
 * @param {number} input.ad_budget_monthly
 * @param {number} input.first_month_total
 * @returns {string}
 */
export function buildEckdatenBlock({
  brand,
  positions = [],
  setup_total = 0,
  ad_budget_monthly = 0,
  first_month_total = 0,
} = {}) {
  const setupLines   = positions.filter(p => SETUP_CATEGORIES.has(p.category));
  const monthlyLines = positions.filter(p => MONTHLY_CATEGORIES.has(p.category));

  const servicePauschale = monthlyLines.find(p => SERVICE_PAUSCHALE_SKUS.has(p.sku));
  const extraMonthlyLines = monthlyLines
    .filter(p => !SERVICE_PAUSCHALE_SKUS.has(p.sku))
    .filter(p => (Number(p.line_total) || 0) > 0);

  // "Unsere Leistung"-Block
  const leistungLines = [];
  if (setupLines.length > 0 || Number(setup_total) > 0) {
    leistungLines.push(`• Setup (einmalig): ${fmtEur(setup_total)}`);
  }
  if (servicePauschale) {
    leistungLines.push(`• Servicepauschale (monatlich): ${fmtEur(servicePauschale.line_total)}`);
  }
  for (const l of extraMonthlyLines) {
    // Bei Menge > 1 (Extra-Stellen) den Multiplikator anzeigen — sonst wirkt die
    // Zeilensumme aus der Luft gegriffen. Titel wird kompakt gehalten.
    const qty = Number(l.quantity) || 1;
    const label = qty > 1 ? `${l.title} × ${qty}` : l.title;
    leistungLines.push(`• ${label} (monatlich): ${fmtEur(l.line_total)}`);
  }

  // Zusammensetzen
  const paragraphs = [];
  paragraphs.push(`Unsere Leistung:\n${leistungLines.join('\n')}`);

  const adBudget = Number(ad_budget_monthly) || 0;
  if (brand === 'talentone') {
    if (adBudget > 0) {
      paragraphs.push(`Ihr Werbebudget (über TalentOne abgewickelt, monatlich im Voraus): ${fmtEur(adBudget)}`);
    }
    paragraphs.push(`Gesamtbetrag Monat 1: ${fmtEur(first_month_total)}`);
  } else {
    // Nowag & Wirth: kein Budget-Betrag in der Aufstellung — kommt separat als
    // Hinweis nach dem Gesamtbetrag.
    paragraphs.push(`Gesamtbetrag Monat 1: ${fmtEur(first_month_total)}`);
    paragraphs.push('Hinzu kommt Ihr Werbebudget, das Sie unmittelbar an den Werbeplattformbetreiber entrichten (Empfehlung: 20–40 € täglich pro Stelle).');
  }

  return paragraphs.join('\n\n');
}
