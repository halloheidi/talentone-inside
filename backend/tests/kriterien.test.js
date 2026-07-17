import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeKriterien, kriterienNamen, kundenVorqualSpalten } from '../kriterien.js';
import { effektiveVorqualFelder, VORQUAL_STANDARD } from '../vorqualifizierung.js';

test('normalizeKriterien: trimmt, wirft Leere weg, pflicht ist bool', () => {
  const out = normalizeKriterien([
    { kriterium: ' Berufserfahrung ', anforderung: ' mind. 3 Jahre ', pflicht: true },
    { kriterium: 'Führerschein B', pflicht: 'ja' },
    { kriterium: '   ' },              // leer → raus
    null,                              // null → raus
  ]);
  assert.deepEqual(out, [
    { kriterium: 'Berufserfahrung', anforderung: 'mind. 3 Jahre', pflicht: true },
    { kriterium: 'Führerschein B', anforderung: null, pflicht: true },
  ]);
});

test('normalizeKriterien: kein Array → leere Liste', () => {
  assert.deepEqual(normalizeKriterien(null), []);
  assert.deepEqual(normalizeKriterien('x'), []);
});

test('kriterienNamen', () => {
  assert.deepEqual(kriterienNamen({ wichtige_kriterien: [{ kriterium: 'Alter' }] }), ['Alter']);
  assert.deepEqual(kriterienNamen({}), []);
});

// ─────────── kundenVorqualSpalten ───────────
const felder = [{ name: 'Ausbildung' }, { name: 'Alter' }, { name: 'Erreichbarkeit' }];

test('befuellte Felder werden Spalten, leere nicht', () => {
  const spalten = kundenVorqualSpalten({
    felder,
    werte: [{ Ausbildung: 'Maurer' }, { Ausbildung: '' }],
    kriterien: [],
  });
  assert.deepEqual(spalten, [{ name: 'Ausbildung', wichtig: false }]);
});

test('wichtige Kriterien sind IMMER Spalte — auch wenn nirgends befuellt', () => {
  const spalten = kundenVorqualSpalten({
    felder,
    werte: [{}],
    kriterien: ['Führerschein B'],
  });
  assert.deepEqual(spalten, [{ name: 'Führerschein B', wichtig: true }]);
});

test('Reihenfolge: erst wichtige Kriterien, dann uebrige befuellte Felder', () => {
  const spalten = kundenVorqualSpalten({
    felder,
    werte: [{ Ausbildung: 'Maurer', Alter: '30' }],
    kriterien: ['Erreichbarkeit'],
  });
  assert.deepEqual(spalten, [
    { name: 'Erreichbarkeit', wichtig: true },   // wichtig, obwohl leer
    { name: 'Ausbildung', wichtig: false },
    { name: 'Alter', wichtig: false },
  ]);
});

test('keine Duplikate, wenn ein Kriterium zugleich befuelltes Feld ist', () => {
  const spalten = kundenVorqualSpalten({
    felder,
    werte: [{ Ausbildung: 'Maurer' }],
    kriterien: ['Ausbildung'],
  });
  assert.deepEqual(spalten, [{ name: 'Ausbildung', wichtig: true }]);
});

test('Werte, die nur Whitespace sind, zaehlen nicht als befuellt', () => {
  const spalten = kundenVorqualSpalten({ felder, werte: [{ Alter: '   ' }], kriterien: [] });
  assert.deepEqual(spalten, []);
});

// ─────────── effektiveVorqualFelder (Backend-Spiegel) ───────────
test('effektiveVorqualFelder: Fallback auf Standard-Set bei aktiver Vorqual ohne Felder', () => {
  assert.equal(effektiveVorqualFelder({ vorqualifizierung: true, vorqualifizierung_felder: [] }), VORQUAL_STANDARD);
  assert.deepEqual(effektiveVorqualFelder({ vorqualifizierung: false, vorqualifizierung_felder: [] }), []);
  assert.deepEqual(effektiveVorqualFelder({ vorqualifizierung: true, vorqualifizierung_felder: [{ name: 'X' }] }), [{ name: 'X' }]);
});
