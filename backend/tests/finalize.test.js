// Tests für die Rechnungs-Finalisierungs-Logik.
//
// looksLikeDraft muss robust gegen wechselnde easybill-Response-Formate sein
// (verschiedene Marker: number leer, document_type='DRAFT', status='DRAFT',
// document_type_editable=true). Der ensureFinalized-Aufrufer verlässt sich
// darauf, dass wir bereits-finalisierte Dokumente nicht erneut PUT'en.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeDraft } from '../easybill.js';

// ─────────────────────── Draft-Erkennung ───────────────────────

test('looksLikeDraft: leere number → Draft', () => {
  assert.equal(looksLikeDraft({ number: null }), true);
  assert.equal(looksLikeDraft({ number: '' }), true);
  assert.equal(looksLikeDraft({ number: '  ' }), true);
  assert.equal(looksLikeDraft({ }), true); // number-Feld fehlt komplett
});

test('looksLikeDraft: gesetzte number → NICHT Draft', () => {
  assert.equal(looksLikeDraft({ number: '2026-0042' }), false);
  assert.equal(looksLikeDraft({ number: 'RE-12345' }), false);
  assert.equal(looksLikeDraft({ number: 12345 }), false);
});

test('looksLikeDraft: expliziter document_type=DRAFT ohne number → Draft', () => {
  assert.equal(looksLikeDraft({ document_type: 'DRAFT' }), true);
  assert.equal(looksLikeDraft({ document_type: 'DRAFT', number: null }), true);
});

test('looksLikeDraft: expliziter status=DRAFT ohne number → Draft', () => {
  assert.equal(looksLikeDraft({ status: 'DRAFT' }), true);
});

test('looksLikeDraft: document_type_editable=true mit fehlender number → Draft', () => {
  assert.equal(looksLikeDraft({ document_type_editable: true }), true);
});

test('looksLikeDraft: document_type_editable=true, aber number gesetzt → NICHT Draft', () => {
  // Kann in easybill vorkommen wenn ein Doc finalisiert aber noch editierbar ist —
  // wir zählen es als "nicht Draft", weil die Rechnungsnummer bereits vergeben ist.
  assert.equal(looksLikeDraft({ document_type_editable: true, number: 'RE-2026-1' }), false);
});

test('looksLikeDraft: null / undefined → false (kein Grund zu finalisieren)', () => {
  assert.equal(looksLikeDraft(null), false);
  assert.equal(looksLikeDraft(undefined), false);
});
