import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  billingPhaseOf, computeOfferMrrShareForMonth, computeMrr,
  computeAcceptanceRate, computeFunnel, computeChurn, computeAvgTurnaround,
} from '../controlling-service.js';

const start = (y, m, d) => new Date(Date.UTC(y, m - 1, d));

// ─────────── billingPhaseOf ───────────
test('billingPhaseOf: ended > paused > inactive > hire=active > guarantee > guarantee_expired', () => {
  assert.equal(billingPhaseOf({ billing_ended_at: '2026-01-01' }), 'ended');
  assert.equal(billingPhaseOf({ billing_paused_at: '2026-01-01' }), 'paused');
  assert.equal(billingPhaseOf({}), 'inactive');
  assert.equal(billingPhaseOf({ campaign_started_at: '2026-06-01', guarantee_period_days: 30 }, 1, start(2026, 8, 1)), 'active');
  assert.equal(billingPhaseOf({ campaign_started_at: '2026-06-01', guarantee_period_days: 30 }, 0, start(2026, 6, 15)), 'guarantee');
  assert.equal(billingPhaseOf({ campaign_started_at: '2026-06-01', guarantee_period_days: 30 }, 0, start(2026, 8, 1)), 'guarantee_expired');
});

// ─────────── computeOfferMrrShareForMonth ───────────
test('MRR-Anteil: Abo läuft den ganzen Monat → voller monthly_total', () => {
  const offer = { brand: 'nowag_wirth', campaign_started_at: '2026-05-01',
                  guarantee_period_days: 60, monthly_total: 1990 };
  const r = computeOfferMrrShareForMonth(offer, 0, start(2026, 6, 1), start(2026, 6, 30));
  assert.equal(r.phase, 'guarantee');
  assert.equal(r.days_active, 30);
  assert.equal(r.amount, 1990);
});

test('MRR-Anteil: Abo startet am 15. → anteilig (16/31 vom Monatsbetrag)', () => {
  const offer = { brand: 'nowag_wirth', campaign_started_at: '2026-06-15',
                  guarantee_period_days: 30, monthly_total: 1990 };
  const r = computeOfferMrrShareForMonth(offer, 0, start(2026, 6, 1), start(2026, 6, 30));
  // 30-15+1 = 16 Tage aktiv im Juni; 30 Tage im Monat
  assert.equal(r.days_active, 16);
  assert.equal(r.days_in_month, 30);
  assert.equal(r.amount, Math.round(1990 * 16 / 30 * 100) / 100);
});

test('MRR-Anteil: Abo endet am 10. → anteilig (10/31)', () => {
  const offer = { brand: 'talentone', campaign_started_at: '2026-05-01',
                  billing_ended_at: '2026-06-10T12:00:00Z',
                  guarantee_period_days: 30, monthly_total: 1490 };
  const r = computeOfferMrrShareForMonth(offer, 1, start(2026, 6, 1), start(2026, 6, 30));
  assert.equal(r.days_active, 10);
});

test('MRR-Anteil: guarantee_expired → 0 € (obwohl monthly_total > 0)', () => {
  const offer = { brand: 'nowag_wirth', campaign_started_at: '2026-04-01',
                  guarantee_period_days: 30, monthly_total: 1990 };
  // Am 30.06. ist die Frist (30.04.) längst weg + keine Einstellung
  const r = computeOfferMrrShareForMonth(offer, 0, start(2026, 6, 1), start(2026, 6, 30));
  assert.equal(r.phase, 'guarantee_expired');
  assert.equal(r.amount, 0);
});

test('MRR-Anteil: paused → 0 €', () => {
  const offer = { brand: 'talentone', campaign_started_at: '2026-05-01',
                  billing_paused_at: '2026-06-05T00:00:00Z',
                  guarantee_period_days: 30, monthly_total: 1490 };
  const r = computeOfferMrrShareForMonth(offer, 0, start(2026, 6, 1), start(2026, 6, 30));
  assert.equal(r.phase, 'paused');
  assert.equal(r.amount, 0);
});

// ─────────── computeMrr ───────────
test('MRR gesamt: guarantee + active gezählt, guarantee_expired ausgeschlossen', () => {
  const offers = [
    // In guarantee → 1990
    { offer: { brand: 'nowag_wirth', campaign_started_at: '2026-06-01', guarantee_period_days: 60, monthly_total: 1990 }, hire_count: 0 },
    // Active (Hire) → 1490
    { offer: { brand: 'talentone', campaign_started_at: '2026-01-01', guarantee_period_days: 30, monthly_total: 1490 }, hire_count: 1 },
    // guarantee_expired (kein Hire, seit April) → 0
    { offer: { brand: 'nowag_wirth', campaign_started_at: '2026-04-01', guarantee_period_days: 30, monthly_total: 999 }, hire_count: 0 },
    // ended → 0
    { offer: { brand: 'talentone', campaign_started_at: '2026-01-01', billing_ended_at: '2026-05-31', monthly_total: 500 }, hire_count: 0 },
    // paused → 0
    { offer: { brand: 'talentone', campaign_started_at: '2026-01-01', billing_paused_at: '2026-06-01T00:00:00Z', monthly_total: 700 }, hire_count: 0 },
  ];
  const r = computeMrr(offers, start(2026, 6, 1), start(2026, 6, 30));
  assert.equal(r.total, 1990 + 1490);
  assert.equal(r.in_guarantee, 1990);
  assert.equal(r.by_brand.nowag_wirth, 1990);
  assert.equal(r.by_brand.talentone, 1490);
});

test('MRR: Werbebudget wird NIE eingerechnet (monthly_total ist per Kontrakt ohne Budget)', () => {
  // monthly_total ist die pure Servicepauschale, ad_budget_monthly ist separat.
  // Diese Regel wird durch die Berechnung nur mit monthly_total garantiert —
  // dieser Test dient als Erinnerung/Kontrakt.
  const offers = [
    { offer: { brand: 'talentone', campaign_started_at: '2026-01-01', monthly_total: 1490, ad_budget_monthly: 800 }, hire_count: 1 },
  ];
  const r = computeMrr(offers, start(2026, 6, 1), start(2026, 6, 30));
  assert.equal(r.total, 1490); // nicht 2290
});

// ─────────── computeAcceptanceRate ───────────
test('Annahmequote: accepted OHNE sent kommt in ZÄHLER UND NENNER (kein > 100 %)', () => {
  const offers = [
    // sent + accepted im Zeitraum
    { sent_at: '2026-06-05', accepted_at: '2026-06-15' },
    // sent im Zeitraum, nicht accepted
    { sent_at: '2026-06-10', accepted_at: null },
    // Direkt-accepted im Zeitraum (nie sent)
    { sent_at: null,        accepted_at: '2026-06-20' },
    // Außerhalb Zeitraum
    { sent_at: '2026-05-30', accepted_at: '2026-07-05' },
  ];
  const r = computeAcceptanceRate(offers, { from: start(2026, 6, 1), to: start(2026, 6, 30) });
  assert.equal(r.sent, 3);      // 2 mit sent + 1 direkt-accepted (auch im Nenner)
  assert.equal(r.accepted, 2);
  // 2/3 = 66.7 %
  assert.equal(r.rate, 66.7);
});

test('Annahmequote: leere Menge → 0 %, keine Division-by-zero', () => {
  const r = computeAcceptanceRate([], { from: start(2026, 1, 1), to: start(2026, 12, 31) });
  assert.equal(r.rate, 0);
});

// ─────────── computeFunnel ───────────
test('Funnel: created/sent/accepted je Marke im Zeitraum', () => {
  const offers = [
    { brand: 'talentone',   created_at: '2026-06-10', sent_at: '2026-06-15', accepted_at: '2026-06-20' },
    { brand: 'talentone',   created_at: '2026-06-05', sent_at: '2026-06-08', accepted_at: null },
    { brand: 'nowag_wirth', created_at: '2026-06-20', sent_at: null, accepted_at: null },
    { brand: 'nowag_wirth', created_at: '2026-05-30', sent_at: '2026-06-01', accepted_at: '2026-06-05' },
  ];
  const r = computeFunnel(offers, { from: start(2026, 6, 1), to: start(2026, 6, 30) });
  assert.deepEqual(r.talentone,   { created: 2, sent: 2, accepted: 1 });
  assert.deepEqual(r.nowag_wirth, { created: 1, sent: 1, accepted: 1 });
});

// ─────────── computeChurn ───────────
test('Churn: beendete im Zeitraum ÷ aktive zu Periodenbeginn', () => {
  const offers = [
    // Aktiv zu Periodenbeginn (started vorher, nicht beendet)
    { campaign_started_at: '2026-01-01', billing_ended_at: null },
    // Aktiv, beendet im Zeitraum → Churn
    { campaign_started_at: '2026-01-01', billing_ended_at: '2026-06-15T00:00:00Z' },
    // Beendet vor Periode → nicht aktiv, nicht churn
    { campaign_started_at: '2026-01-01', billing_ended_at: '2026-05-01T00:00:00Z' },
    // Startet nach Periode → weder aktiv noch churn
    { campaign_started_at: '2026-07-15', billing_ended_at: null },
  ];
  const r = computeChurn(offers, { from: start(2026, 6, 1), to: start(2026, 6, 30) });
  assert.equal(r.active_at_start, 2);
  assert.equal(r.ended_in_range, 1);
  assert.equal(r.rate, 50);
});

// ─────────── computeAvgTurnaround ───────────
test('Ø sent → accepted: nur Angebote mit BEIDEN Stempeln im Zeitraum (nach accepted_at)', () => {
  const offers = [
    { sent_at: '2026-06-01', accepted_at: '2026-06-11' },  // 10 Tage
    { sent_at: '2026-06-05', accepted_at: '2026-06-25' },  // 20 Tage
    { sent_at: '2026-06-10', accepted_at: null },          // nicht gezählt
    { sent_at: '2026-06-01', accepted_at: '2026-07-05' },  // außerhalb, nicht gezählt
  ];
  const r = computeAvgTurnaround(offers, { from: start(2026, 6, 1), to: start(2026, 6, 30) });
  assert.equal(r.count, 2);
  assert.equal(r.avg_days, 15);
});
