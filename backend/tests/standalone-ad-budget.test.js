// Tests für die freistehende Werbekosten-Rechnung (Migration 013):
//   - Standalone (source='standalone', offer_id=null) läuft im Sync-Scope mit
//   - offer_id=NULL bricht keine bestehende Sync-Predicate
//   - Ampel-Bewertung greift für Standalone-ad_budget-Rechnungen
//     (überfällig > 7 Tage → blocked; überfällig ≤ 7 → pending; sonst ok)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isInSyncScope,
  evaluateAmpelStatus,
  OPEN_STATUSES,
} from '../invoice-sync.js';

const DAY = 86400000;

// ─────────────────────── Sync-Scope ───────────────────────

test('Sync-Scope: Standalone-Rechnung mit status=sent qualifiziert (kein Filter auf source/offer_id)', () => {
  const inv = {
    id: 'x', source: 'standalone', offer_id: null,
    invoice_type: 'ad_budget', status: 'sent',
    easybill_document_id: '1234',
  };
  assert.equal(isInSyncScope(inv), true);
});

test('Sync-Scope: Offer-Billing-Rechnung ebenso qualifiziert (source/offer_id egal)', () => {
  const inv = {
    id: 'y', source: 'offer_billing', offer_id: 'o1',
    invoice_type: 'setup', status: 'overdue',
    easybill_document_id: '9999',
  };
  assert.equal(isInSyncScope(inv), true);
});

test('Sync-Scope: draft/paid/cancelled fallen raus', () => {
  for (const status of ['draft', 'paid', 'cancelled']) {
    assert.equal(isInSyncScope({ status, easybill_document_id: '1' }), false, status);
  }
});

test('Sync-Scope: fehlende easybill_document_id → skip', () => {
  assert.equal(isInSyncScope({ status: 'sent', easybill_document_id: null }), false);
});

test('OPEN_STATUSES ist stabil und enthält alle offenen Zustände', () => {
  assert.deepEqual([...OPEN_STATUSES].sort(),
    ['overdue', 'partially_paid', 'sent'].sort());
});

// ─────────────────────── Ampel-Wirkung ───────────────────────

test('Ampel: keine relevanten Rechnungen → ok', () => {
  assert.equal(evaluateAmpelStatus([], new Date('2026-07-10')), 'ok');
});

test('Ampel: Standalone-ad_budget, überfällig 3 Tage → pending', () => {
  const now = new Date('2026-07-10');
  const invs = [{
    invoice_type: 'ad_budget', status: 'sent', source: 'standalone', offer_id: null,
    due_date: '2026-07-07', // 3 Tage überfällig
  }];
  assert.equal(evaluateAmpelStatus(invs, now), 'pending');
});

test('Ampel: Standalone-ad_budget, überfällig 8 Tage → blocked', () => {
  const now = new Date('2026-07-10');
  const invs = [{
    invoice_type: 'ad_budget', status: 'overdue', source: 'standalone', offer_id: null,
    due_date: '2026-07-02', // 8 Tage überfällig
  }];
  assert.equal(evaluateAmpelStatus(invs, now), 'blocked');
});

test('Ampel: gemischter Kunde (Abo + Standalone) — die stärkere Stufe gewinnt', () => {
  const now = new Date('2026-07-10');
  const invs = [
    { invoice_type: 'monthly_combined', status: 'sent', due_date: '2026-07-08' },  // 2 Tage → pending
    { invoice_type: 'ad_budget',        status: 'sent', due_date: '2026-07-01', source: 'standalone' }, // 9 Tage → blocked
  ];
  assert.equal(evaluateAmpelStatus(invs, now), 'blocked');
});

test('Ampel: bezahlte Rechnungen zählen NICHT (Status außerhalb OPEN_STATUSES)', () => {
  const now = new Date('2026-07-10');
  const invs = [{
    invoice_type: 'ad_budget', status: 'paid',
    due_date: '2026-01-01', // wäre 190+ Tage überfällig, aber paid
  }];
  assert.equal(evaluateAmpelStatus(invs, now), 'ok');
});

test('Ampel: setup-Rechnungen zählen NICHT (nur ad_budget + monthly_combined greifen)', () => {
  const now = new Date('2026-07-10');
  const invs = [{
    invoice_type: 'setup', status: 'overdue', due_date: '2026-06-01', // 39 Tage
  }];
  assert.equal(evaluateAmpelStatus(invs, now), 'ok');
});

test('offer_id=NULL bricht keine Predicate — Standalone-Rechnungen behandelt wie andere', () => {
  const inv = {
    invoice_type: 'ad_budget', status: 'sent', source: 'standalone',
    offer_id: null, easybill_document_id: 'ebd_1',
    due_date: '2026-07-05',
  };
  assert.equal(isInSyncScope(inv), true);
  assert.equal(evaluateAmpelStatus([inv], new Date('2026-07-10')), 'pending');
});
