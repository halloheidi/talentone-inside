// Tests für den Direkt-Auftragsbestätigung-Weg (Wizard → CHARGE_CONFIRM):
//   - Setup-Rechnungs-Dup-Check muss BEIDE ref_ids abfragen
//     (Angebots-Doc-ID UND AB-Doc-ID), damit der Direkt-AB-Fall greift.
//   - Rücksync ignoriert Rows ohne easybill_document_id automatisch
//     — hier verifiziert über die pure Funktion computeTransitionPatch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectSetupDupRefIds } from '../invoice-service.js';
import { computeTransitionPatch } from '../offer-sync.js';

test('Dup-Check: klassisch Angebot → INVOICE ergibt nur Angebots-ref_id', () => {
  const offer = { easybill_document_id: '111', easybill_order_document_id: null };
  assert.deepEqual(collectSetupDupRefIds(offer), ['111']);
});

test('Dup-Check: Direkt-AB (kein Angebot) → nutzt AB-Doc-ID', () => {
  const offer = { easybill_document_id: null, easybill_order_document_id: '222' };
  assert.deepEqual(collectSetupDupRefIds(offer), ['222']);
});

test('Dup-Check: klassisch Angebot → AB → INVOICE — beide ref_ids abgefragt', () => {
  const offer = { easybill_document_id: '111', easybill_order_document_id: '222' };
  assert.deepEqual(collectSetupDupRefIds(offer), ['111', '222']);
});

test('Dup-Check: kein easybill-Doc → leere Liste', () => {
  assert.deepEqual(collectSetupDupRefIds({}), []);
  assert.deepEqual(collectSetupDupRefIds(null), []);
});

test('Rücksync-Robustheit: computeTransitionPatch ist no-op ohne Successor (Direkt-AB-Fall)', () => {
  // Ein Direkt-AB-Angebot hat status='accepted' + easybill_document_id=null.
  // Der Rücksync-Aufrufer skipt es in syncOne() an der ersten Zeile.
  // Selbst wenn es weiter käme, ergibt computeTransitionPatch ohne Successor
  // ein no-op — kein State-Mutation, kein Fehler.
  const { patch, changed } = computeTransitionPatch(
    { id: 'direct', status: 'accepted', easybill_document_id: null,
      easybill_order_document_id: '999', accepted_at: '2026-07-01T00:00:00Z' },
    null,
    '2026-07-07T12:00:00Z'
  );
  assert.equal(patch, null);
  assert.equal(changed, false);
});
