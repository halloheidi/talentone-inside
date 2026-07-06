import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateOfferTotals } from '../offer-calc.js';

// Referenzkatalog wie im Seed (Migration 002).
const TO_PRODUCTS = [
  { id: 'p-to-onb',     sku: 'TO-SETUP-ONBOARDING',  brand: 'talentone', category: 'setup',           unit_price: 490,  active: true },
  { id: 'p-to-crv',     sku: 'TO-SETUP-CREATIVES',   brand: 'talentone', category: 'setup',           unit_price: 500,  active: true },
  { id: 'p-to-mon',     sku: 'TO-MONTHLY-CAMPAIGN',  brand: 'talentone', category: 'monthly',         unit_price: 1490, active: true },
  { id: 'p-to-vorq',    sku: 'TO-OPT-PREQUALIFY',    brand: 'talentone', category: 'option_monthly',  unit_price: 490,  active: true },
  { id: 'p-to-extra',   sku: 'TO-OPT-EXTRA-JOB',     brand: 'talentone', category: 'option_monthly',  unit_price: 490,  active: true },
];
const NW_PRODUCTS = [
  { id: 'p-nw-ana',    sku: 'NW-SETUP-ANALYSIS',    brand: 'nowag_wirth', category: 'setup',           unit_price: 400,  active: true },
  { id: 'p-nw-kick',   sku: 'NW-SETUP-KICKOFF',     brand: 'nowag_wirth', category: 'setup',           unit_price: 300,  active: true },
  { id: 'p-nw-crv',    sku: 'NW-SETUP-CREATIVES',   brand: 'nowag_wirth', category: 'setup',           unit_price: 600,  active: true },
  { id: 'p-nw-tech',   sku: 'NW-SETUP-TECH',        brand: 'nowag_wirth', category: 'setup',           unit_price: 1600, active: true },
  { id: 'p-nw-mon',    sku: 'NW-MONTHLY-CAMPAIGN',  brand: 'nowag_wirth', category: 'monthly',         unit_price: 1990, active: true },
  { id: 'p-nw-photo',  sku: 'NW-OPT-PHOTO',         brand: 'nowag_wirth', category: 'option_setup',    unit_price: 690,  active: true },
  { id: 'p-nw-extra',  sku: 'NW-OPT-EXTRA-JOB',     brand: 'nowag_wirth', category: 'option_monthly',  unit_price: 690,  active: true },
];

test('TalentOne — Standardpaket ohne Optionen, ohne Budget', () => {
  const r = calculateOfferTotals({
    products: TO_PRODUCTS,
    selected: [{ product_id: 'p-to-onb' }, { product_id: 'p-to-crv' }, { product_id: 'p-to-mon' }],
    extra_job_sku: 'TO-OPT-EXTRA-JOB',
  });
  assert.equal(r.setup_total, 990);     // 490 + 500
  assert.equal(r.monthly_total, 1490);  // Service-Pauschale
  assert.equal(r.ad_budget_monthly, 0);
  assert.equal(r.first_month_total, 990 + 1490); // 2480
  assert.equal(r.gross.first_month_gross, 2951.2);
  assert.equal(r.vat.first_month_vat, 471.2);
});

test('TalentOne — mit Vorqualifizierung + Werbebudget 800€', () => {
  const r = calculateOfferTotals({
    products: TO_PRODUCTS,
    selected: [
      { product_id: 'p-to-onb' }, { product_id: 'p-to-crv' },
      { product_id: 'p-to-mon' }, { product_id: 'p-to-vorq' },
    ],
    ad_budget_monthly: 800,
    extra_job_sku: 'TO-OPT-EXTRA-JOB',
  });
  assert.equal(r.setup_total, 990);
  assert.equal(r.monthly_total, 1490 + 490);       // Service + Vorqual
  assert.equal(r.ad_budget_monthly, 800);
  assert.equal(r.first_month_total, 990 + 1980 + 800); // 3770
});

test('TalentOne — 2 zusätzliche parallele Stellen (additional_positions_count=2)', () => {
  const r = calculateOfferTotals({
    products: TO_PRODUCTS,
    selected: [
      { product_id: 'p-to-onb' }, { product_id: 'p-to-crv' },
      { product_id: 'p-to-mon' }, { product_id: 'p-to-extra' },
    ],
    additional_positions_count: 2,
    extra_job_sku: 'TO-OPT-EXTRA-JOB',
  });
  // 2 extra Stellen à 490 = 980 zusätzlich zur Service-Pauschale (1490)
  assert.equal(r.monthly_total, 1490 + 980);
  const extraLine = r.positions.find(l => l.sku === 'TO-OPT-EXTRA-JOB');
  assert.equal(extraLine.quantity, 2);
  assert.equal(extraLine.line_total, 980);
});

test('Nowag & Wirth — Vollpaket ohne Optionen', () => {
  const r = calculateOfferTotals({
    products: NW_PRODUCTS,
    selected: [
      { product_id: 'p-nw-ana' }, { product_id: 'p-nw-kick' },
      { product_id: 'p-nw-crv' }, { product_id: 'p-nw-tech' },
      { product_id: 'p-nw-mon' },
    ],
    extra_job_sku: 'NW-OPT-EXTRA-JOB',
  });
  assert.equal(r.setup_total, 400 + 300 + 600 + 1600); // 2900
  assert.equal(r.monthly_total, 1990);
  assert.equal(r.ad_budget_monthly, 0);                // N&W: nie Budget
  assert.equal(r.first_month_total, 2900 + 1990);      // 4890
});

test('N&W — mit Fotopaket-Option und extra Stelle', () => {
  const r = calculateOfferTotals({
    products: NW_PRODUCTS,
    selected: [
      { product_id: 'p-nw-ana' }, { product_id: 'p-nw-kick' },
      { product_id: 'p-nw-crv' }, { product_id: 'p-nw-tech' },
      { product_id: 'p-nw-mon' },
      { product_id: 'p-nw-photo' },                 // Setup-Option
      { product_id: 'p-nw-extra' },                 // Monthly-Option
    ],
    additional_positions_count: 1,
    extra_job_sku: 'NW-OPT-EXTRA-JOB',
  });
  assert.equal(r.setup_total, 2900 + 690);           // + Fotopaket
  assert.equal(r.monthly_total, 1990 + 690);         // + 1 extra Stelle
});

test('Ignoriert unbekannte + inaktive Produkt-IDs', () => {
  const products = [
    ...TO_PRODUCTS,
    { id: 'p-inactive', sku: 'INACT', brand: 'talentone', category: 'setup', unit_price: 9999, active: false },
  ];
  const r = calculateOfferTotals({
    products,
    selected: [
      { product_id: 'p-to-onb' },
      { product_id: 'p-inactive' },              // wird ignoriert
      { product_id: 'p-unknown-xyz' },           // wird ignoriert
    ],
    extra_job_sku: 'TO-OPT-EXTRA-JOB',
  });
  assert.equal(r.positions.length, 1);
  assert.equal(r.setup_total, 490);
});

test('Doppelte Auswahl derselben Position wird deduplizieret', () => {
  const r = calculateOfferTotals({
    products: TO_PRODUCTS,
    selected: [
      { product_id: 'p-to-onb' },
      { product_id: 'p-to-onb', quantity: 5 }, // wird ignoriert (schon gesehen)
    ],
    extra_job_sku: 'TO-OPT-EXTRA-JOB',
  });
  assert.equal(r.positions.length, 1);
  assert.equal(r.positions[0].quantity, 1);
});

test('USt-Anteile werden bei allen Buckets korrekt berechnet (Rundung auf Cent)', () => {
  const r = calculateOfferTotals({
    products: TO_PRODUCTS,
    selected: [{ product_id: 'p-to-onb' }, { product_id: 'p-to-crv' }, { product_id: 'p-to-mon' }],
    ad_budget_monthly: 1234.56,
    vat_rate: 19,
    extra_job_sku: 'TO-OPT-EXTRA-JOB',
  });
  assert.equal(r.setup_total, 990);
  assert.equal(r.ad_budget_monthly, 1234.56);
  assert.equal(r.vat.setup_vat, 188.10);
  assert.equal(r.vat.ad_budget_vat, 234.57);
  assert.equal(r.gross.setup_gross, 1178.10);
});

test('Werbebudget = 0 oder null ergibt ad_budget_monthly = 0', () => {
  const r1 = calculateOfferTotals({ products: TO_PRODUCTS, selected: [], ad_budget_monthly: null });
  const r2 = calculateOfferTotals({ products: TO_PRODUCTS, selected: [], ad_budget_monthly: 0 });
  const r3 = calculateOfferTotals({ products: TO_PRODUCTS, selected: [], ad_budget_monthly: -50 });
  assert.equal(r1.ad_budget_monthly, 0);
  assert.equal(r2.ad_budget_monthly, 0);
  assert.equal(r3.ad_budget_monthly, 0);
});

test('additional_positions_count nur bei Extra-Job-SKUs aktiv, andere Positions bleiben 1×', () => {
  const r = calculateOfferTotals({
    products: TO_PRODUCTS,
    selected: [
      { product_id: 'p-to-onb', quantity: 3 }, // ignoriert, weil nicht Extra-Job
      { product_id: 'p-to-vorq' },
    ],
    additional_positions_count: 5,
    extra_job_skus: ['TO-OPT-EXTRA-JOB-SETUP', 'TO-OPT-EXTRA-JOB'],
  });
  const onb = r.positions.find(l => l.sku === 'TO-SETUP-ONBOARDING');
  assert.equal(onb.quantity, 1); // quantity>1 ist nur bei Extra-Job erlaubt (siehe Wizard-Kontrakt)
});

test('Extra-Job Kopplung (n=2): Setup + Monthly beide mit quantity=2', () => {
  // Simuliert Wizard-Verhalten: Counter=2 aktiviert Extra-Job-SETUP + -MONTHLY
  // gemeinsam. calc muss beide mit derselben quantity abbilden.
  const products = [
    ...TO_PRODUCTS,
    { id: 'p-to-extra-setup', sku: 'TO-OPT-EXTRA-JOB-SETUP', brand: 'talentone',
      category: 'option_setup', unit_price: 290, active: true },
  ];
  const r = calculateOfferTotals({
    products,
    selected: [
      { product_id: 'p-to-onb' }, { product_id: 'p-to-crv' }, { product_id: 'p-to-mon' },
      { product_id: 'p-to-extra-setup' },
      { product_id: 'p-to-extra' },
    ],
    additional_positions_count: 2,
    extra_job_skus: ['TO-OPT-EXTRA-JOB-SETUP', 'TO-OPT-EXTRA-JOB'],
  });
  const setup   = r.positions.find(l => l.sku === 'TO-OPT-EXTRA-JOB-SETUP');
  const monthly = r.positions.find(l => l.sku === 'TO-OPT-EXTRA-JOB');
  assert.equal(setup.quantity, 2);
  assert.equal(monthly.quantity, 2);
  assert.equal(setup.line_total,   580);   // 290 × 2
  assert.equal(monthly.line_total, 980);   // 490 × 2

  // Setup-Total: Basis-Setup (990) + Extra-Setup-Total (580) = 1570
  assert.equal(r.setup_total,   990 + 580);
  // Monthly-Total: Basis-Monthly (1490) + Extra-Monthly-Total (980) = 2470
  assert.equal(r.monthly_total, 1490 + 980);
  // Merge-Tag {{monat_1}} = first_month_total inkl. beider Extra-Job-Rows
  assert.equal(r.first_month_total, (990 + 580) + (1490 + 980));
});

test('Backwards-Compat: alter extra_job_sku-Parameter wirkt weiter', () => {
  const r = calculateOfferTotals({
    products: TO_PRODUCTS,
    selected: [{ product_id: 'p-to-mon' }, { product_id: 'p-to-extra' }],
    additional_positions_count: 3,
    extra_job_sku: 'TO-OPT-EXTRA-JOB',
  });
  const extra = r.positions.find(l => l.sku === 'TO-OPT-EXTRA-JOB');
  assert.equal(extra.quantity, 3);
});
