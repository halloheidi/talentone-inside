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
    templates: TEMPLATES,
  });
  // Reihenfolge
  assert.equal(items[0].description.startsWith('Onboarding\n\n'), true);
  assert.equal(items[1].description.startsWith('Creatives\n\n'), true);
  assert.equal(items[2].description.startsWith('Kampagne (monatlich)\n\n'), true);
  assert.equal(items[3].description.startsWith('Werbebudget-Abwicklung (monatlich im Voraus)\n\n'), true);
  assert.equal(items[3].single_price_net, 800);
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
  assert.deepEqual(descriptions, [
    'Analyse',
    'Monatlich (monatlich)',
    'Bewerbungsgarantie',
    'Zahlungsbedingungen',
  ]);
  const anyBudget = items.some(i => i.description.includes('Werbebudget'));
  assert.equal(anyBudget, false);
});

test('Extra-Job mit additional_positions_count=3 setzt quantity und line_total korrekt', () => {
  const { items } = buildEasybillOfferPayload({
    brand: 'talentone',
    products: TO_PRODUCTS,
    selected: [{ product_id: 'p-mon' }, { product_id: 'p-extra' }],
    additional_positions_count: 3,
    templates: [],
  });
  const extra = items.find(i => i.description.startsWith('Extra Job'));
  assert.equal(extra.quantity, 3);
  assert.equal(extra.single_price_net, 490); // Einzelpreis pro Stelle
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
