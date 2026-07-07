import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEffectiveAdBudget } from '../offer-calc.js';

// Der zur Periode gültige Betrag ist der letzte History-Eintrag, dessen
// effective_from ≤ periodStart ist. Ohne History fällt es auf
// offer.ad_budget_monthly zurück.
test('getEffectiveAdBudget — ohne Historie → Fallback auf offer.ad_budget_monthly', () => {
  const offer = { brand: 'talentone', ad_budget_monthly: 800 };
  assert.equal(getEffectiveAdBudget(offer, [], '2026-08-01'), 800);
});

test('getEffectiveAdBudget — anderer Brand als TalentOne → 0', () => {
  const offer = { brand: 'nowag_wirth', ad_budget_monthly: 1000 };
  assert.equal(getEffectiveAdBudget(offer, [], '2026-08-01'), 0);
});

test('getEffectiveAdBudget — Budget-Änderung Mitte des Monats: aktuelle Periode alter Betrag, Folgeperiode neuer', () => {
  // Angebot mit initial 800; am 15. Juli auf 1000 geändert (effective 1. August)
  const offer = { brand: 'talentone', ad_budget_monthly: 800 };
  const history = [
    { new_amount: 1000, effective_from: '2026-08-01' },
  ];
  // Juli-Periode (aktuell laufend): noch alter Betrag
  assert.equal(getEffectiveAdBudget(offer, history, '2026-07-01'), 800);
  // August-Periode (Folgeperiode): neuer Betrag
  assert.equal(getEffectiveAdBudget(offer, history, '2026-08-01'), 1000);
});

test('getEffectiveAdBudget — mehrere Änderungen, letzte gültige gewinnt', () => {
  const offer = { brand: 'talentone', ad_budget_monthly: 600 };
  const history = [
    { new_amount: 800,  effective_from: '2026-03-01' },
    { new_amount: 1000, effective_from: '2026-06-01' },
    { new_amount: 500,  effective_from: '2026-09-01' },
  ];
  assert.equal(getEffectiveAdBudget(offer, history, '2026-02-01'), 600);   // vor allen
  assert.equal(getEffectiveAdBudget(offer, history, '2026-03-01'), 800);   // exakt am Wechsel
  assert.equal(getEffectiveAdBudget(offer, history, '2026-05-15'), 800);   // zwischen
  assert.equal(getEffectiveAdBudget(offer, history, '2026-07-01'), 1000);  // nach zweitem
  assert.equal(getEffectiveAdBudget(offer, history, '2026-12-01'), 500);   // nach drittem
});
