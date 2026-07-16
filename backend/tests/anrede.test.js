import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anrede, t, anredeForm, anredeOffen, vornameAus, nachnameAus } from '../anrede.js';

test('vornameAus / nachnameAus', () => {
  assert.equal(vornameAus('Marc Petersen'), 'Marc');
  assert.equal(nachnameAus('Marc Petersen'), 'Petersen');
  assert.equal(nachnameAus('Uwe'), null);        // nur ein Token → kein Nachname
  assert.equal(nachnameAus('Anna von der Leyen'), 'Leyen');
  assert.equal(vornameAus(''), null);
  assert.equal(nachnameAus(null), null);
});

test('anrede: Du → Hallo <Vorname>', () => {
  assert.equal(anrede({ anrede_form: 'du', ansprechpartner: 'Uwe Junk' }), 'Hallo Uwe');
  assert.equal(anrede({ anrede_form: 'du', ansprechpartner: '' }), 'Hallo');
});

test('anrede: Sie → Hallo Herr/Frau <Nachname>', () => {
  assert.equal(anrede({ anrede_form: 'sie', anrede_titel: 'herr', ansprechpartner: 'Uwe Junk' }), 'Hallo Herr Junk');
  assert.equal(anrede({ anrede_form: 'sie', anrede_titel: 'frau', ansprechpartner: 'Anna Junk' }), 'Hallo Frau Junk');
});

test('anrede: Sie nutzt explizites nachname-Feld vor Ableitung', () => {
  const k = { anrede_form: 'sie', anrede_titel: 'frau', ansprechpartner: 'Anna Müller-Lüdenscheidt', nachname: 'Müller-Lüdenscheidt' };
  assert.equal(anrede(k), 'Hallo Frau Müller-Lüdenscheidt');
});

test('anrede: Sie ohne Titel/Namen → neutrales "Guten Tag" (nie "Hallo undefined")', () => {
  assert.equal(anrede({ anrede_form: 'sie', ansprechpartner: 'Uwe Junk' }), 'Guten Tag'); // Titel fehlt
  assert.equal(anrede({ anrede_form: 'sie', anrede_titel: 'herr', ansprechpartner: '' }), 'Guten Tag');
});

test('anredeForm: Fallback du, wenn nicht festgelegt', () => {
  assert.equal(anredeForm({}), 'du');
  assert.equal(anredeForm({ anrede_form: null }), 'du');
  assert.equal(anredeForm({ anrede_form: 'sie' }), 'sie');
});

test('anredeOffen: nur true solange nichts festgelegt ist', () => {
  assert.equal(anredeOffen({}), true);
  assert.equal(anredeOffen({ anrede_form: null }), true);
  assert.equal(anredeOffen({ anrede_form: 'du' }), false);
  assert.equal(anredeOffen({ anrede_form: 'sie' }), false);
});

test('t: waehlt Formulierung nach Form', () => {
  assert.equal(t({ anrede_form: 'du' },  'deine Entwürfe', 'Ihre Entwürfe'), 'deine Entwürfe');
  assert.equal(t({ anrede_form: 'sie' }, 'deine Entwürfe', 'Ihre Entwürfe'), 'Ihre Entwürfe');
  assert.equal(t({},                     'deine Entwürfe', 'Ihre Entwürfe'), 'deine Entwürfe'); // Fallback
});
