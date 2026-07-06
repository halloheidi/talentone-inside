import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEasybillOfferPayload } from '../offer-easybill-builder.js';

const TO_PRODUCTS = [
  { id: 'p-onb',   sku: 'TO-SETUP-ONBOARDING', brand: 'talentone', category: 'setup',          title: 'Onboarding', description: 'Setup-Onboarding-Volltext.', unit_price: 490, sort_order: 10, active: true },
  { id: 'p-crv',   sku: 'TO-SETUP-CREATIVES',  brand: 'talentone', category: 'setup',          title: 'Creatives',  description: 'Setup-Creatives-Volltext.',  unit_price: 500, sort_order: 20, active: true },
  { id: 'p-mon',   sku: 'TO-MONTHLY-CAMPAIGN', brand: 'talentone', category: 'monthly',        title: 'Kampagne',   description: 'Monatliche-Betreuung.',      unit_price: 1490, sort_order: 30, active: true },
  { id: 'p-vorq',  sku: 'TO-OPT-PREQUALIFY',   brand: 'talentone', category: 'option_monthly', title: 'Vorqual',    description: 'Vorqual-Volltext.',          unit_price: 490, sort_order: 40, active: true },
  { id: 'p-extra', sku: 'TO-OPT-EXTRA-JOB',    brand: 'talentone', category: 'option_monthly', title: 'Extra Job',  description: 'Extra-Job-Volltext.',        unit_price: 490, sort_order: 50, active: true },
];
const TEMPLATES = [
  { key: 'guarantee',     text: 'Bewerbungsgarantie: Wir garantieren…' },
  { key: 'payment_terms', text: 'Zahlungsziel 7 Tage.' },
];

test('Standard-Payload: Setup → Monatlich → Werbebudget → Garantie → Zahlungsbedingungen', () => {
  const { items } = buildEasybillOfferPayload({
    brand: 'talentone',
    products: TO_PRODUCTS,
    selected: [{ product_id: 'p-onb' }, { product_id: 'p-crv' }, { product_id: 'p-mon' }],
    ad_budget_monthly: 800,
    templates: [
      ...TEMPLATES,
      { key: 'guarantee_label', text: 'Bewerbungsgarantie' },
    ],
  });
  // Reihenfolge
  assert.equal(items[0].description.startsWith('Onboarding\n\n'), true);
  assert.equal(items[1].description.startsWith('Creatives\n\n'), true);
  assert.equal(items[2].description.startsWith('Kampagne (monatlich)\n\n'), true);
  assert.equal(items[3].description.startsWith('Werbebudget-Abwicklung (monatlich im Voraus)\n\n'), true);
  // easybill erwartet Cent → 800 € → 80000
  assert.equal(items[3].single_price_net, 80000);
  assert.equal(items[4].type, 'TEXT');
  assert.match(items[4].description, /Bewerbungsgarantie/);
  assert.equal(items[5].type, 'TEXT');
  assert.match(items[5].description, /Zahlungsziel/);
  // Position-Feld ist streng aufsteigend
  for (let i = 0; i < items.length - 1; i++) {
    assert.equal(items[i].position + 1, items[i + 1].position);
  }
});

test('N&W: kein Werbebudget-Posten, aber Schlusstexte weiterhin da', () => {
  const { items } = buildEasybillOfferPayload({
    brand: 'nowag_wirth',
    products: [
      { id: 'nw-a', sku: 'NW-SETUP-ANALYSIS', brand: 'nowag_wirth', category: 'setup',   title: 'Analyse', description: 'Analyse-Text.', unit_price: 400, sort_order: 10, active: true },
      { id: 'nw-m', sku: 'NW-MONTHLY-CAMPAIGN', brand: 'nowag_wirth', category: 'monthly', title: 'Monatlich', description: 'Monatlich-Text.', unit_price: 1990, sort_order: 30, active: true },
    ],
    selected: [{ product_id: 'nw-a' }, { product_id: 'nw-m' }],
    ad_budget_monthly: 999,           // wird ignoriert (brand != talentone)
    templates: TEMPLATES,
  });
  const descriptions = items.map(i => i.description.split('\n')[0]);
  // N&W → 'Erfolgsgarantie' via Default-Label (kein guarantee_label-Template gepflegt)
  assert.deepEqual(descriptions, [
    'Analyse',
    'Monatlich (monatlich)',
    'Erfolgsgarantie',
    'Zahlungsbedingungen',
  ]);
  const anyBudget = items.some(i => i.description.includes('Werbebudget'));
  assert.equal(anyBudget, false);
});

test('Extra-Job mit additional_positions_count=3 setzt quantity und Einzelpreis korrekt', () => {
  const { items } = buildEasybillOfferPayload({
    brand: 'talentone',
    products: TO_PRODUCTS,
    selected: [{ product_id: 'p-mon' }, { product_id: 'p-extra' }],
    additional_positions_count: 3,
    templates: [],
  });
  const extra = items.find(i => i.description.startsWith('Extra Job'));
  assert.equal(extra.quantity, 3);
  // 490 € Einzelpreis pro Stelle → 49000 Cent; easybill × 3 = 147000
  assert.equal(extra.single_price_net, 49000);
});

test('Positionstext ist mehrsätzig und wird komplett übernommen', () => {
  const longDesc = 'Satz 1. Satz 2. Satz 3 mit Umlaut ü und 1.234,56 €. Satz 4.';
  const products = [{ id: 'p1', sku: 'X', brand: 'talentone', category: 'setup', title: 'Position 1', description: longDesc, unit_price: 100, sort_order: 10, active: true }];
  const { items } = buildEasybillOfferPayload({
    brand: 'talentone', products, selected: [{ product_id: 'p1' }], templates: [],
  });
  assert.match(items[0].description, /Position 1\n\nSatz 1\. Satz 2\. Satz 3 mit Umlaut ü und 1\.234,56 €\. Satz 4\./);
});

test('Ohne Schlusstexte werden auch keine TEXT-Positionen erzeugt', () => {
  const { items } = buildEasybillOfferPayload({
    brand: 'talentone', products: TO_PRODUCTS,
    selected: [{ product_id: 'p-onb' }, { product_id: 'p-mon' }],
    templates: [],
  });
  const anyText = items.some(i => i.type === 'TEXT');
  assert.equal(anyText, false);
});

test('easybill single_price_net wird in Cent übergeben (Euro × 100)', () => {
  // easybill-Spec: "Price in cents, despite being of type float (150 = 1.50€)".
  // 490 € muss als 49000 rüber, 1490 € als 149000, 800 € als 80000.
  const { items } = buildEasybillOfferPayload({
    brand: 'talentone',
    products: TO_PRODUCTS,
    selected: [{ product_id: 'p-onb' }, { product_id: 'p-crv' }, { product_id: 'p-mon' }],
    ad_budget_monthly: 800,
    templates: TEMPLATES,
  });
  const onb    = items.find(i => i.description.startsWith('Onboarding'));
  const crv    = items.find(i => i.description.startsWith('Creatives'));
  const mon    = items.find(i => i.description.startsWith('Kampagne'));
  const budget = items.find(i => i.description.startsWith('Werbebudget'));
  assert.equal(onb.single_price_net,    49000);
  assert.equal(crv.single_price_net,    50000);
  assert.equal(mon.single_price_net,   149000);
  assert.equal(budget.single_price_net, 80000);
  // vat_percent bleibt in Prozent (nicht in Basispunkten)
  assert.equal(onb.vat_percent, 19);
});

test('Cent-Konvertierung rundet fair (kein Float-Drift)', () => {
  const products = [{ id: 'p', sku: 'X', brand: 'talentone', category: 'setup', title: 'X', description: '', unit_price: 12.345, sort_order: 10, active: true }];
  const { items } = buildEasybillOfferPayload({
    brand: 'talentone', products, selected: [{ product_id: 'p' }], templates: [],
  });
  // 12.345 € × 100 = 1234.5 → runden auf 1235 (halfround up)
  assert.equal(items[0].single_price_net, 1235);
});

test('Garantie-Label wird markenabhängig gewählt (TalentOne = Bewerbungsgarantie)', () => {
  const { items } = buildEasybillOfferPayload({
    brand: 'talentone',
    products: TO_PRODUCTS,
    selected: [{ product_id: 'p-onb' }],
    templates: [
      { key: 'guarantee',       text: 'Text der Garantie.' },
      { key: 'guarantee_label', text: 'Bewerbungsgarantie' },
    ],
  });
  const g = items.find(i => i.type === 'TEXT');
  assert.match(g.description, /^Bewerbungsgarantie\n\nText der Garantie\./);
});

test('Garantie-Label wird markenabhängig gewählt (N&W = Erfolgsgarantie)', () => {
  const products = [{ id: 'nw-a', sku: 'NW-SETUP-ANALYSIS', brand: 'nowag_wirth', category: 'setup', title: 'Analyse', description: '', unit_price: 400, sort_order: 10, active: true }];
  const { items } = buildEasybillOfferPayload({
    brand: 'nowag_wirth',
    products,
    selected: [{ product_id: 'nw-a' }],
    templates: [
      { key: 'guarantee',       text: 'Text der Erfolgsgarantie.' },
      { key: 'guarantee_label', text: 'Erfolgsgarantie' },
    ],
  });
  const g = items.find(i => i.type === 'TEXT');
  assert.match(g.description, /^Erfolgsgarantie\n\nText der Erfolgsgarantie\./);
});

test('Fällt zurück auf Default-Label wenn guarantee_label-Template fehlt', () => {
  // TalentOne ohne guarantee_label → Fallback aus DEFAULT_GUARANTEE_LABEL_BY_BRAND
  const { items: itemsTO } = buildEasybillOfferPayload({
    brand: 'talentone', products: TO_PRODUCTS,
    selected: [{ product_id: 'p-onb' }],
    templates: [{ key: 'guarantee', text: 'G-Text' }],
  });
  assert.match(itemsTO.find(i => i.type === 'TEXT').description, /^Bewerbungsgarantie\n/);

  // N&W ohne guarantee_label → Fallback
  const nwProducts = [{ id: 'nw-a', sku: 'NW-SETUP-ANALYSIS', brand: 'nowag_wirth', category: 'setup', title: 'Analyse', description: '', unit_price: 400, sort_order: 10, active: true }];
  const { items: itemsNW } = buildEasybillOfferPayload({
    brand: 'nowag_wirth', products: nwProducts,
    selected: [{ product_id: 'nw-a' }],
    templates: [{ key: 'guarantee', text: 'G-Text' }],
  });
  assert.match(itemsNW.find(i => i.type === 'TEXT').description, /^Erfolgsgarantie\n/);
});
