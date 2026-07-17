import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeKriterien, kriterienNamen, kundenVorqualSpalten,
  normFeldname, matchFeld, syncKriterienMitFeldern,
} from '../kriterien.js';
import { effektiveVorqualFelder, VORQUAL_STANDARD } from '../vorqualifizierung.js';

test('normalizeKriterien: trimmt, wirft Leere weg, pflicht ist bool', () => {
  const out = normalizeKriterien([
    { kriterium: ' Berufserfahrung ', anforderung: ' mind. 3 Jahre ', pflicht: true },
    { kriterium: 'Führerschein', pflicht: 'ja' },
    { kriterium: '   ' }, null,
  ]);
  assert.deepEqual(out, [
    { kriterium: 'Berufserfahrung', anforderung: 'mind. 3 Jahre', pflicht: true },
    { kriterium: 'Führerschein', anforderung: null, pflicht: true },
  ]);
});

test('normalizeKriterien: kein Array → leere Liste', () => {
  assert.deepEqual(normalizeKriterien(null), []);
});

test('kriterienNamen', () => {
  assert.deepEqual(kriterienNamen({ wichtige_kriterien: [{ kriterium: 'Alter' }] }), ['Alter']);
  assert.deepEqual(kriterienNamen({}), []);
});

// ─────────── normFeldname / matchFeld ───────────
test('normFeldname: Umlaute + Sonderzeichen', () => {
  assert.equal(normFeldname('Führerschein'), 'fuehrerschein');
  assert.equal(normFeldname('Gehaltsvorstellung (brutto)'), 'gehaltsvorstellungbrutto');
  assert.equal(normFeldname('PLZ / Wohnort'), 'plzwohnort');
});

const FELDER = VORQUAL_STANDARD.map(f => f.name);

test('matchFeld: exakt (auch mit abweichender Schreibweise)', () => {
  assert.equal(matchFeld('Führerschein', FELDER), 'Führerschein');
  assert.equal(matchFeld('fuehrerschein', FELDER), 'Führerschein');
  assert.equal(matchFeld('AUSBILDUNG', FELDER), 'Ausbildung');
});

test('matchFeld: "Führerschein B" trifft Feld "Führerschein" (keine Doppel-Spalte)', () => {
  assert.equal(matchFeld('Führerschein B', FELDER), 'Führerschein');
  assert.equal(matchFeld('Führerschein Klasse B', FELDER), 'Führerschein');
});

test('matchFeld: laengster Treffer gewinnt', () => {
  const felder = ['Gehalt', 'Gehaltsvorstellung (brutto)'];
  assert.equal(matchFeld('Gehaltsvorstellung', felder), 'Gehaltsvorstellung (brutto)');
});

test('matchFeld: echtes Neuland → null', () => {
  assert.equal(matchFeld('Schwindelfreiheit', FELDER), null);
  assert.equal(matchFeld('', FELDER), null);
});

test('matchFeld: sehr kurze Feldnamen loesen keine Zufallstreffer aus', () => {
  assert.equal(matchFeld('Schwindelfreiheit', ['Alt']), null);
});

// ─────────── syncKriterienMitFeldern (Invariante) ───────────
test('sync: Kriterium wird auf bestehendes Feld gezogen, kein neues Feld', () => {
  const felder = [{ name: 'Führerschein', typ: 'dropdown' }];
  const { kriterien, felder: out } = syncKriterienMitFeldern({
    kriterien: [{ kriterium: 'Führerschein B', anforderung: 'Klasse B', pflicht: true }],
    felder,
  });
  assert.deepEqual(kriterien, [{ kriterium: 'Führerschein', anforderung: 'Klasse B', pflicht: true }]);
  assert.equal(out.length, 1);                       // KEIN neues Feld
  assert.equal(out[0].typ, 'dropdown');              // bestehendes Feld unveraendert
});

test('sync: echtes Neuland legt gleichnamiges Feld an', () => {
  const { kriterien, felder } = syncKriterienMitFeldern({
    kriterien: [{ kriterium: 'Schwindelfreiheit', pflicht: true }],
    felder: [{ name: 'Alter', typ: 'text' }],
  });
  assert.deepEqual(kriterien, [{ kriterium: 'Schwindelfreiheit', anforderung: null, pflicht: true }]);
  assert.deepEqual(felder.map(f => f.name), ['Alter', 'Schwindelfreiheit']);
});

test('sync: pro Feld nur EIN Kriterium (spaeteres gewinnt)', () => {
  const { kriterien, felder } = syncKriterienMitFeldern({
    kriterien: [
      { kriterium: 'Führerschein', anforderung: 'alt' },
      { kriterium: 'Führerschein B', anforderung: 'Klasse B', pflicht: true },
    ],
    felder: [{ name: 'Führerschein', typ: 'text' }],
  });
  assert.equal(kriterien.length, 1);
  assert.deepEqual(kriterien[0], { kriterium: 'Führerschein', anforderung: 'Klasse B', pflicht: true });
  assert.equal(felder.length, 1);
});

test('sync: Invariante — jedes Kriterium hat genau ein Feld', () => {
  const { kriterien, felder } = syncKriterienMitFeldern({
    kriterien: [{ kriterium: 'Führerschein B' }, { kriterium: 'Schwindelfreiheit' }, { kriterium: 'Ausbildung' }],
    felder: VORQUAL_STANDARD,
  });
  for (const k of kriterien) {
    assert.ok(felder.some(f => f.name === k.kriterium), `Feld fehlt fuer ${k.kriterium}`);
  }
});

// ─────────── kundenVorqualSpalten ───────────
const felder = [{ name: 'Ausbildung' }, { name: 'Alter' }, { name: 'Erreichbarkeit' }];

test('befuellte Felder werden Spalten, leere nicht', () => {
  const spalten = kundenVorqualSpalten({ felder, werte: [{ Ausbildung: 'Maurer' }, { Ausbildung: '' }], kriterien: [] });
  assert.deepEqual(spalten, [{ name: 'Ausbildung', wichtig: false, anforderung: null, pflicht: false }]);
});

test('wichtige Kriterien sind IMMER Spalte — auch leer, inkl. Anforderung', () => {
  const spalten = kundenVorqualSpalten({
    felder, werte: [{}],
    kriterien: [{ kriterium: 'Erreichbarkeit', anforderung: 'vormittags', pflicht: true }],
  });
  assert.deepEqual(spalten, [{ name: 'Erreichbarkeit', wichtig: true, anforderung: 'vormittags', pflicht: true }]);
});

test('Reihenfolge: erst wichtige Kriterien, dann uebrige befuellte Felder', () => {
  const spalten = kundenVorqualSpalten({
    felder, werte: [{ Ausbildung: 'Maurer', Alter: '30' }],
    kriterien: [{ kriterium: 'Erreichbarkeit' }],
  });
  assert.deepEqual(spalten.map(s => s.name), ['Erreichbarkeit', 'Ausbildung', 'Alter']);
});

test('keine Doppel-Spalte, wenn Kriterium zugleich befuelltes Feld ist', () => {
  const spalten = kundenVorqualSpalten({
    felder, werte: [{ Ausbildung: 'Maurer' }], kriterien: [{ kriterium: 'Ausbildung' }],
  });
  assert.deepEqual(spalten, [{ name: 'Ausbildung', wichtig: true, anforderung: null, pflicht: false }]);
});

test('Whitespace-Werte zaehlen nicht als befuellt', () => {
  assert.deepEqual(kundenVorqualSpalten({ felder, werte: [{ Alter: '   ' }], kriterien: [] }), []);
});

test('kundenVorqualSpalten akzeptiert auch reine Namens-Strings', () => {
  const spalten = kundenVorqualSpalten({ felder, werte: [{}], kriterien: ['Alter'] });
  assert.deepEqual(spalten, [{ name: 'Alter', wichtig: true, anforderung: null, pflicht: false }]);
});

// ─────────── effektiveVorqualFelder ───────────
test('effektiveVorqualFelder: Fallback auf Standard-Set bei aktiver Vorqual ohne Felder', () => {
  assert.equal(effektiveVorqualFelder({ vorqualifizierung: true, vorqualifizierung_felder: [] }), VORQUAL_STANDARD);
  assert.deepEqual(effektiveVorqualFelder({ vorqualifizierung: false, vorqualifizierung_felder: [] }), []);
});
