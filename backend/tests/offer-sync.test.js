// Unit-Tests für die Rücksync-Logik (Phase 4).
// Testen die reinen Funktionen computeTransitionPatch + pickSuccessor —
// die IO-Wrapper (applyAcceptedTransition/syncOne) werden im E2E-Test
// gegen easybill+DB abgedeckt.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTransitionPatch, pickSuccessor } from '../offer-sync.js';

const NOW = '2026-07-07T12:00:00.000Z';

test('computeTransitionPatch: CHARGE_CONFIRM setzt Status + AB-ID + accepted_at', () => {
  const offer = { id: 'o1', status: 'created', easybill_document_id: '111',
                  easybill_order_document_id: null, accepted_at: null };
  const { patch, changed, noop } = computeTransitionPatch(
    offer, { id: 222, type: 'CHARGE_CONFIRM' }, NOW
  );
  assert.equal(changed, true);
  assert.equal(noop, null);
  assert.equal(patch.status, 'accepted');
  assert.equal(patch.easybill_order_document_id, '222');
  assert.equal(patch.accepted_at, NOW);
  assert.equal(patch.last_synced_at, NOW);
});

test('computeTransitionPatch: direkte INVOICE setzt Status ohne AB-ID', () => {
  const offer = { id: 'o2', status: 'created', easybill_document_id: '333',
                  easybill_order_document_id: null, accepted_at: null };
  const { patch, changed } = computeTransitionPatch(
    offer, { id: 444, type: 'INVOICE' }, NOW
  );
  assert.equal(changed, true);
  assert.equal(patch.status, 'accepted');
  assert.equal(patch.accepted_at, NOW);
  assert.equal(patch.easybill_order_document_id, undefined,
    'Bei INVOICE bleibt AB-ID unangetastet (wird nicht ins Patch aufgenommen)');
});

test('computeTransitionPatch: IDEMPOTENZ — gleiches CHARGE_CONFIRM zweimal → nur last_synced_at', () => {
  const offer = { id: 'o3', status: 'accepted', easybill_document_id: '555',
                  easybill_order_document_id: '666', accepted_at: '2026-01-01T00:00:00Z' };
  const { patch, changed, noop } = computeTransitionPatch(
    offer, { id: 666, type: 'CHARGE_CONFIRM' }, NOW
  );
  assert.equal(changed, false);
  assert.equal(noop, 'already_in_sync');
  assert.deepEqual(Object.keys(patch), ['last_synced_at'],
    'Kein Statuswechsel — nur last_synced_at wird fortgeschrieben');
  assert.equal(patch.last_synced_at, NOW);
});

test('computeTransitionPatch: bereits accepted, aber andere AB-ID → Update (nachträgliche Korrektur)', () => {
  // Wenn easybill die AB neu erzeugt (mit anderer ID), folgen wir dem — es ist
  // die neue Wahrheit.
  const offer = { id: 'o4', status: 'accepted', easybill_document_id: '777',
                  easybill_order_document_id: '100', accepted_at: '2026-01-01T00:00:00Z' };
  const { patch, changed } = computeTransitionPatch(
    offer, { id: 200, type: 'CHARGE_CONFIRM' }, NOW
  );
  assert.equal(changed, true);
  assert.equal(patch.easybill_order_document_id, '200');
  // accepted_at wird NICHT überschrieben (behält den Original-Zeitpunkt)
  assert.equal(patch.accepted_at, '2026-01-01T00:00:00Z');
});

test('computeTransitionPatch: fehlender Successor → no-op', () => {
  const { patch, changed } = computeTransitionPatch({ id: 'o5' }, null, NOW);
  assert.equal(patch, null);
  assert.equal(changed, false);
});

test('pickSuccessor: CHARGE_CONFIRM wird vor INVOICE bevorzugt', () => {
  const successors = [
    { id: 111, type: 'INVOICE' },
    { id: 222, type: 'CHARGE_CONFIRM' },
  ];
  const chosen = pickSuccessor(successors);
  assert.equal(chosen.id, 222);
  assert.equal(chosen.type, 'CHARGE_CONFIRM');
});

test('pickSuccessor: nur INVOICEs → erste INVOICE', () => {
  const successors = [
    { id: 111, type: 'INVOICE' },
    { id: 112, type: 'INVOICE' },
  ];
  const chosen = pickSuccessor(successors);
  assert.equal(chosen.id, 111);
});

test('pickSuccessor: leeres Array → null', () => {
  assert.equal(pickSuccessor([]), null);
  assert.equal(pickSuccessor(null), null);
  assert.equal(pickSuccessor(undefined), null);
});
