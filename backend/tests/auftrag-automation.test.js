// Tests für die dynamische Auftrags-Checkliste. Reine Funktion — keine DB.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAuftragChecklist } from '../auftrag-automation.js';

const STANDARD_KEYS = [
  'onboarding_call',
  'handyfotos_anfordern',
  'ki_creatives',
  'qualifikationsseite',
  'kampagnen_setup',
];

test('Standard: alle 5 Pflicht-Items in korrekter Reihenfolge, keine Add-ons', () => {
  const items = buildAuftragChecklist({
    selectedSkus: ['NW-SETUP-ANALYSIS', 'NW-SETUP-KICKOFF', 'NW-SETUP-TECH', 'NW-SETUP-CREATIVES', 'NW-MONTHLY-CAMPAIGN'],
  });
  assert.deepEqual(items.map(i => i.key), STANDARD_KEYS);
  assert.equal(items.every(i => i.done === false), true);
});

test('Standard mit Fototag → zusätzlicher Item „Fototag terminieren"', () => {
  const items = buildAuftragChecklist({
    selectedSkus: ['NW-SETUP-ANALYSIS', 'NW-MONTHLY-CAMPAIGN', 'NW-OPT-PHOTO'],
  });
  const keys = items.map(i => i.key);
  assert.deepEqual(keys.slice(0, 5), STANDARD_KEYS);
  assert.equal(keys.includes('fototag_terminieren'), true);
});

test('Standard mit Vorqualifizierung (N&W) → „Vorqualifizierung briefen (Jessica)"', () => {
  const items = buildAuftragChecklist({
    selectedSkus: ['NW-MONTHLY-CAMPAIGN', 'NW-OPT-PREQUALIFY'],
  });
  const vorqual = items.find(i => i.key === 'vorqual_briefen');
  assert.ok(vorqual);
  assert.match(vorqual.label, /Jessica/);
});

test('Standard mit Vorqualifizierung (TalentOne) → gleiches Item', () => {
  const items = buildAuftragChecklist({
    selectedSkus: ['TO-MONTHLY-CAMPAIGN', 'TO-OPT-PREQUALIFY'],
  });
  assert.ok(items.find(i => i.key === 'vorqual_briefen'));
});

test('Standard mit 2 Extra-Stellen → zwei „Stellenprofil N einrichten"-Items', () => {
  const items = buildAuftragChecklist({
    selectedSkus: ['TO-MONTHLY-CAMPAIGN', 'TO-OPT-EXTRA-JOB'],
    additionalPositionsCount: 2,
  });
  const extras = items.filter(i => i.key.startsWith('stellenprofil_'));
  assert.equal(extras.length, 2);
  assert.deepEqual(extras.map(i => i.label), [
    'Stellenprofil 1 einrichten',
    'Stellenprofil 2 einrichten',
  ]);
});

test('Extra-Stellen: additional_positions_count > 0 ohne Extra-Job-SKU → keine Extra-Items', () => {
  const items = buildAuftragChecklist({
    selectedSkus: ['TO-MONTHLY-CAMPAIGN'],
    additionalPositionsCount: 3,
  });
  assert.equal(items.filter(i => i.key.startsWith('stellenprofil_')).length, 0);
});

test('Kombination: Fototag + Vorqualifizierung + 2 Extra-Stellen (Vollausbau)', () => {
  const items = buildAuftragChecklist({
    selectedSkus: [
      'NW-SETUP-CREATIVES', 'NW-OPT-PHOTO', 'NW-MONTHLY-CAMPAIGN',
      'NW-OPT-PREQUALIFY', 'NW-OPT-EXTRA-JOB',
    ],
    additionalPositionsCount: 2,
  });
  const keys = items.map(i => i.key);
  // Standard-5 immer da
  for (const k of STANDARD_KEYS) assert.ok(keys.includes(k), `${k} fehlt`);
  // Plus alle Add-ons
  assert.ok(keys.includes('fototag_terminieren'));
  assert.ok(keys.includes('vorqual_briefen'));
  assert.ok(keys.includes('stellenprofil_1'));
  assert.ok(keys.includes('stellenprofil_2'));
});

test('done-Flag ist immer initial false — nichts abgehakt', () => {
  const items = buildAuftragChecklist({
    selectedSkus: ['NW-MONTHLY-CAMPAIGN', 'NW-OPT-PHOTO', 'NW-OPT-PREQUALIFY', 'NW-OPT-EXTRA-JOB'],
    additionalPositionsCount: 1,
  });
  assert.equal(items.every(i => i.done === false), true);
});

test('Robustheit: leere/undefined-Eingaben ergeben nur die 5 Pflicht-Items', () => {
  assert.deepEqual(
    buildAuftragChecklist({}).map(i => i.key),
    STANDARD_KEYS
  );
  assert.deepEqual(
    buildAuftragChecklist({ selectedSkus: null, additionalPositionsCount: null }).map(i => i.key),
    STANDARD_KEYS
  );
});
