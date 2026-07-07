// Tests für den Eckdaten-Merge-Tag-Renderer.
//
// Kernregel: Der Gesamtbetrag ist IMMER exakt die Summe der aufgelisteten
// Beträge. Deshalb: Zeilen erzeugen aus tatsächlichen Positionen +
// Werbebudget-Zeile (TalentOne) — nichts stumm hinzufügen, nichts weglassen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEckdatenBlock } from '../mail-eckdaten.js';

// ─────────────────────── TalentOne ───────────────────────

test('TalentOne — Standardpaket (Setup + Servicepauschale + Werbebudget)', () => {
  const positions = [
    { sku: 'TO-SETUP-ONBOARDING', title: 'Onboarding',       category: 'setup',   quantity: 1, line_total: 490 },
    { sku: 'TO-SETUP-CREATIVES',  title: 'Creatives',        category: 'setup',   quantity: 1, line_total: 500 },
    { sku: 'TO-MONTHLY-CAMPAIGN', title: 'Kampagne',         category: 'monthly', quantity: 1, line_total: 1490 },
  ];
  const out = buildEckdatenBlock({
    brand: 'talentone', positions,
    setup_total: 990, ad_budget_monthly: 1000, first_month_total: 3480,
  });
  // Setup-Aggregat + Servicepauschale + Werbebudget als Zeilen
  assert.match(out, /Setup \(einmalig\): 990,00\s?€/);
  assert.match(out, /Servicepauschale \(monatlich\): 1\.490,00\s?€/);
  assert.match(out, /Werbebudget \(über TalentOne abgewickelt, monatlich im Voraus\): 1\.000,00\s?€/);
  assert.match(out, /Gesamtbetrag Monat 1: 3\.480,00\s?€/);
});

test('TalentOne — Konfig mit Vorqualifizierung → eigene Zeile, Summe stimmt', () => {
  const positions = [
    { sku: 'TO-SETUP-ONBOARDING', title: 'Onboarding',                 category: 'setup',          quantity: 1, line_total: 490 },
    { sku: 'TO-SETUP-CREATIVES',  title: 'Creatives',                  category: 'setup',          quantity: 1, line_total: 500 },
    { sku: 'TO-MONTHLY-CAMPAIGN', title: 'Kampagne',                   category: 'monthly',        quantity: 1, line_total: 1490 },
    { sku: 'TO-OPT-PREQUALIFY',   title: 'Telefonische Vorqualifizierung', category: 'option_monthly', quantity: 1, line_total: 490 },
  ];
  const out = buildEckdatenBlock({
    brand: 'talentone', positions,
    setup_total: 990, ad_budget_monthly: 800, first_month_total: 3770,
  });
  assert.match(out, /Setup \(einmalig\): 990,00\s?€/);
  assert.match(out, /Servicepauschale \(monatlich\): 1\.490,00\s?€/);
  assert.match(out, /Telefonische Vorqualifizierung \(monatlich\): 490,00\s?€/);
  assert.match(out, /Werbebudget \(über TalentOne abgewickelt, monatlich im Voraus\): 800,00\s?€/);
  assert.match(out, /Gesamtbetrag Monat 1: 3\.770,00\s?€/);
});

test('TalentOne — Extra-Stellen (Qty=2) werden mit Multiplikator ausgewiesen', () => {
  const positions = [
    { sku: 'TO-SETUP-ONBOARDING', title: 'Onboarding',            category: 'setup',          quantity: 1, line_total: 490 },
    { sku: 'TO-SETUP-CREATIVES',  title: 'Creatives',             category: 'setup',          quantity: 1, line_total: 500 },
    { sku: 'TO-OPT-EXTRA-JOB-SETUP', title: 'Setup weitere Stelle', category: 'option_setup', quantity: 2, line_total: 580 },
    { sku: 'TO-MONTHLY-CAMPAIGN', title: 'Kampagne',              category: 'monthly',        quantity: 1, line_total: 1490 },
    { sku: 'TO-OPT-EXTRA-JOB',    title: 'Weitere Stelle',        category: 'option_monthly', quantity: 2, line_total: 980 },
  ];
  const out = buildEckdatenBlock({
    brand: 'talentone', positions,
    setup_total: 990 + 580, ad_budget_monthly: 800, first_month_total: (990 + 580) + (1490 + 980) + 800,
  });
  assert.match(out, /Weitere Stelle × 2 \(monatlich\): 980,00\s?€/);
  assert.match(out, /Gesamtbetrag Monat 1: 4\.840,00\s?€/);
});

test('TalentOne — ohne Werbebudget: keine Budget-Zeile, Summe passt', () => {
  const positions = [
    { sku: 'TO-SETUP-ONBOARDING', title: 'Onboarding',    category: 'setup',   quantity: 1, line_total: 490 },
    { sku: 'TO-SETUP-CREATIVES',  title: 'Creatives',     category: 'setup',   quantity: 1, line_total: 500 },
    { sku: 'TO-MONTHLY-CAMPAIGN', title: 'Kampagne',      category: 'monthly', quantity: 1, line_total: 1490 },
  ];
  const out = buildEckdatenBlock({
    brand: 'talentone', positions,
    setup_total: 990, ad_budget_monthly: 0, first_month_total: 2480,
  });
  assert.doesNotMatch(out, /Werbebudget/);
  assert.match(out, /Gesamtbetrag Monat 1: 2\.480,00\s?€/);
});

// ─────────────────────── Nowag & Wirth ───────────────────────

test('N&W — Standardpaket: kein Werbebudget in Aufstellung, aber Meta-Hinweis am Ende', () => {
  const positions = [
    { sku: 'NW-SETUP-ANALYSIS', title: 'Analyse',         category: 'setup',   quantity: 1, line_total: 400 },
    { sku: 'NW-SETUP-KICKOFF',  title: 'Kickoff',         category: 'setup',   quantity: 1, line_total: 300 },
    { sku: 'NW-SETUP-TECH',     title: 'Technik',         category: 'setup',   quantity: 1, line_total: 1600 },
    { sku: 'NW-SETUP-CREATIVES', title: 'KI-Veredelung',  category: 'setup',   quantity: 1, line_total: 600 },
    { sku: 'NW-MONTHLY-CAMPAIGN', title: 'Betreuung',     category: 'monthly', quantity: 1, line_total: 1490 },
    { sku: 'NW-OPT-PREQUALIFY', title: 'Vorqualifizierung', category: 'option_monthly', quantity: 1, line_total: 500 },
  ];
  const out = buildEckdatenBlock({
    brand: 'nowag_wirth', positions,
    setup_total: 2900, ad_budget_monthly: 0, first_month_total: 4890,
  });
  assert.match(out, /Setup \(einmalig\): 2\.900,00\s?€/);
  assert.match(out, /Servicepauschale \(monatlich\): 1\.490,00\s?€/);
  assert.match(out, /Vorqualifizierung \(monatlich\): 500,00\s?€/);
  // N&W: kein Betrag als eigene Werbebudget-Zeile in der Aufstellung
  assert.doesNotMatch(out, /Werbebudget \(über.*abgewickelt/);
  assert.doesNotMatch(out, /^• Werbebudget/m);
  // aber Hinweis-Absatz am Ende
  assert.match(out, /Werbebudget.*unmittelbar an den Werbeplattformbetreiber/);
  assert.match(out, /Empfehlung.*20.*40.*€/);
  assert.match(out, /Gesamtbetrag Monat 1: 4\.890,00\s?€/);
});

// ─────────────────────── Format-Invariante ───────────────────────

test('Beträge immer de-DE mit zwei Nachkommastellen (1.000,00 €, nie 1.000 €)', () => {
  const positions = [
    { sku: 'TO-SETUP-ONBOARDING', title: 'Onboarding',    category: 'setup',   quantity: 1, line_total: 1000 },
    { sku: 'TO-MONTHLY-CAMPAIGN', title: 'Kampagne',      category: 'monthly', quantity: 1, line_total: 1000 },
  ];
  const out = buildEckdatenBlock({
    brand: 'talentone', positions,
    setup_total: 1000, ad_budget_monthly: 1000, first_month_total: 3000,
  });
  // Keine ganzzahligen Beträge ohne Nachkommastellen
  assert.doesNotMatch(out, /: 1\.000\s?€/); // "1.000 €" ohne ,00 verboten
  assert.match(out, /: 1\.000,00\s?€/);     // "1.000,00 €" erforderlich
});
