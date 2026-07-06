import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMonthlyBilling, pickHireMailBodyKey, resolveAbrechnungsHinweis } from '../billing-rules.js';

// ─────────────────── evaluateMonthlyBilling ───────────────────

test('Innerhalb Frist, keine Einstellung → bill_full', () => {
  const offer = { brand: 'talentone', campaign_started_at: '2026-06-01', guarantee_period_days: 30 };
  const r = evaluateMonthlyBilling(offer, { today: new Date('2026-06-15'), hasHire: false });
  assert.equal(r.action, 'bill_full');
  assert.equal(r.reason, 'within_guarantee');
});

test('Nach Frist, keine Einstellung, N&W → skip_and_wait_first_hire (Log-Eintrag folgt)', () => {
  const offer = { brand: 'nowag_wirth', campaign_started_at: '2026-06-01', guarantee_period_days: 30 };
  const r = evaluateMonthlyBilling(offer, { today: new Date('2026-07-10'), hasHire: false });
  assert.equal(r.action, 'skip_and_wait_first_hire');
  assert.equal(r.reason, 'guarantee_no_hire');
});

test('Nach Frist, keine Einstellung, TalentOne (1. mal) → bill_budget_only', () => {
  const offer = { brand: 'talentone', campaign_started_at: '2026-06-01', guarantee_period_days: 30 };
  const r = evaluateMonthlyBilling(offer, {
    today: new Date('2026-07-15'), hasHire: false, serviceFreeMonthsUsed: 0,
  });
  assert.equal(r.action, 'bill_budget_only');
  assert.equal(r.reason, 'guarantee_no_hire');
  assert.match(r.meta.budget_note, /Bewerbungsgarantie/);
});

test('Nach Frist, Einstellung erfasst → bill_full (keine Nachberechnung servicefreier Monate)', () => {
  const offer = { brand: 'talentone', campaign_started_at: '2026-06-01', guarantee_period_days: 30 };
  const r = evaluateMonthlyBilling(offer, {
    today: new Date('2026-08-25'), hasHire: true, serviceFreeMonthsUsed: 1,
  });
  assert.equal(r.action, 'bill_full');
  assert.equal(r.reason, 'hire_registered');
});

test('Zweite Einstellung ändert nichts an der Abrechnung', () => {
  const offer = { brand: 'nowag_wirth', campaign_started_at: '2026-06-01', guarantee_period_days: 30 };
  // Es ist irrelevant, wie viele Einstellungen es sind — Regel schaut nur nach "min. 1"
  const r1 = evaluateMonthlyBilling(offer, { today: new Date('2026-09-01'), hasHire: true });
  const r2 = evaluateMonthlyBilling(offer, { today: new Date('2026-09-01'), hasHire: true });
  assert.deepEqual(r1, r2);
  assert.equal(r1.action, 'bill_full');
});

test('service_waived_override=true → skip_service_waived (trotz laufender Frist)', () => {
  const offer = { brand: 'nowag_wirth', campaign_started_at: '2026-06-01', guarantee_period_days: 30, service_waived_override: true };
  const r = evaluateMonthlyBilling(offer, { today: new Date('2026-06-10'), hasHire: false });
  assert.equal(r.action, 'skip_service_waived');
});

test('60-Tage-Frist: Monat 2 (Tag 45) berechnet, Monat 3 (Tag 75) ohne Einstellung servicefrei (N&W)', () => {
  const offer = { brand: 'nowag_wirth', campaign_started_at: '2026-06-01', guarantee_period_days: 60 };
  const day45 = evaluateMonthlyBilling(offer, { today: new Date('2026-07-16'), hasHire: false });
  const day75 = evaluateMonthlyBilling(offer, { today: new Date('2026-08-15'), hasHire: false });
  assert.equal(day45.action, 'bill_full');
  assert.equal(day75.action, 'skip_and_wait_first_hire');
});

test('TalentOne: 2. servicefreier Monat → skip_manual_reactivation', () => {
  const offer = { brand: 'talentone', campaign_started_at: '2026-06-01', guarantee_period_days: 30 };
  const r = evaluateMonthlyBilling(offer, {
    today: new Date('2026-08-25'), hasHire: false, serviceFreeMonthsUsed: 1,
  });
  assert.equal(r.action, 'skip_manual_reactivation');
  assert.equal(r.reason, 'talentone_max_month_reached');
});

test('billing_paused_at gesetzt → skip_billing_paused', () => {
  const offer = { brand: 'talentone', campaign_started_at: '2026-06-01', guarantee_period_days: 30,
                  billing_paused_at: '2026-07-25', billing_pause_reason: 'talentone_max_month_reached' };
  const r = evaluateMonthlyBilling(offer, { today: new Date('2026-08-25'), hasHire: false });
  assert.equal(r.action, 'skip_billing_paused');
});

test('billing_ended_at gesetzt → skip_campaign_ended', () => {
  const offer = { brand: 'nowag_wirth', campaign_started_at: '2026-06-01', guarantee_period_days: 30,
                  billing_ended_at: '2026-07-31T23:59:00Z' };
  const r = evaluateMonthlyBilling(offer, { today: new Date('2026-08-01'), hasHire: true });
  assert.equal(r.action, 'skip_campaign_ended');
});

// ─────────────────── pickHireMailBodyKey ───────────────────

test('pickHireMailBodyKey: Randfall hires_target=1 → 1. Einstellung ist complete', () => {
  assert.equal(pickHireMailBodyKey({ hiresBefore: 0, hiresTarget: 1 }), 'hire_email_body_complete');
});

test('pickHireMailBodyKey: Ziel 3, 1. Einstellung → first', () => {
  assert.equal(pickHireMailBodyKey({ hiresBefore: 0, hiresTarget: 3 }), 'hire_email_body_first');
});

test('pickHireMailBodyKey: Ziel 3, 2. Einstellung → progress', () => {
  assert.equal(pickHireMailBodyKey({ hiresBefore: 1, hiresTarget: 3 }), 'hire_email_body_progress');
});

test('pickHireMailBodyKey: Ziel 3, 3. Einstellung → complete', () => {
  assert.equal(pickHireMailBodyKey({ hiresBefore: 2, hiresTarget: 3 }), 'hire_email_body_complete');
});

// ─────────────────── resolveAbrechnungsHinweis ───────────────────

test('Abrechnungs-Hinweis: Einstellung innerhalb Frist → "unverändert weiter"', () => {
  const offer = { brand: 'talentone', campaign_started_at: '2026-06-01', guarantee_period_days: 30 };
  const t = resolveAbrechnungsHinweis(offer, { hireDate: new Date('2026-06-15'), serviceFreeMonthsUsed: 0 });
  assert.match(t, /unverändert weiter/);
});

test('Abrechnungs-Hinweis: Einstellung nach servicefreier Phase → "ab X wieder regulär"', () => {
  const offer = { brand: 'talentone', campaign_started_at: '2026-06-01', guarantee_period_days: 30 };
  const t = resolveAbrechnungsHinweis(offer, {
    hireDate: new Date('2026-08-15'), serviceFreeMonthsUsed: 1, naechster_monat: '01.09.2026',
  });
  assert.match(t, /Ab 01\.09\.2026 wird die monatliche Betreuung wieder regulär berechnet/);
});
