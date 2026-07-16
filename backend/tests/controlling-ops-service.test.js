import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSollTage, computeAmpel, berlinParts, tageSeit, AMPEL_CONFIG,
} from '../controlling-ops-service.js';

// ─────────── parseSollTage ───────────
test('parseSollTage: Freitext → Tage; Abo/leer → Default/null', () => {
  assert.equal(parseSollTage('30 Tage'), 30);
  assert.equal(parseSollTage('60 Tage'), 60);
  assert.equal(parseSollTage('90 Tage'), 90);
  assert.equal(parseSollTage('6 Monate'), 180);
  assert.equal(parseSollTage('2 Wochen'), 14);
  assert.equal(parseSollTage(null), 30);          // Default Phase 1
  assert.equal(parseSollTage(''), 30);
  assert.equal(parseSollTage('Abo'), null);       // laufend, kein festes Ende
  assert.equal(parseSollTage('individuell'), null);
});

// ─────────── computeAmpel ───────────
const base = {
  status: 'live', liveTag: 10, sollTage: 30,
  letzteBewerbungTage: 0, bewerbungenSeitLive: 20, letzte7: 5, vorwoche: 5,
};

test('computeAmpel: nicht-live → grau', () => {
  assert.equal(computeAmpel({ ...base, status: 'onboarding' }).ampel, 'grau');
});

test('computeAmpel: 0 Bewerbungen seit 3+ Tagen → rot', () => {
  assert.equal(computeAmpel({ ...base, letzteBewerbungTage: 3 }).ampel, 'rot');
  assert.equal(computeAmpel({ ...base, letzteBewerbungTage: 5 }).ampel, 'rot');
  assert.equal(computeAmpel({ ...base, letzteBewerbungTage: null, bewerbungenSeitLive: 0 }).ampel, 'rot');
});

test('computeAmpel: deutlich unter Soll → rot', () => {
  // liveTag 20 → bewertbar min(21,30)=21 → erwartet 21, Schwelle 10.5; 3 < 10.5 → rot
  const r = computeAmpel({ ...base, liveTag: 20, letzteBewerbungTage: 1, bewerbungenSeitLive: 3 });
  assert.equal(r.ampel, 'rot');
});

test('computeAmpel: rückläufig (< 50% Vorwoche) → gelb', () => {
  const r = computeAmpel({ ...base, letzteBewerbungTage: 1, letzte7: 2, vorwoche: 10 });
  assert.equal(r.ampel, 'gelb');
});

test('computeAmpel: Laufzeit überschritten → gelb', () => {
  const r = computeAmpel({ ...base, liveTag: 35, sollTage: 30, letzteBewerbungTage: 1, bewerbungenSeitLive: 40, letzte7: 5, vorwoche: 5 });
  assert.equal(r.ampel, 'gelb');
});

test('computeAmpel: läuft normal → grün', () => {
  const r = computeAmpel({ ...base, letzteBewerbungTage: 1, letzte7: 6, vorwoche: 5, bewerbungenSeitLive: 20 });
  assert.equal(r.ampel, 'gruen');
});

// ─────────── berlinParts ───────────
test('berlinParts: Sommerzeit (UTC+2) — Wochentag/Stunde lokal', () => {
  // 2026-07-15T09:30:00Z → Berlin 11:30, Mittwoch
  const p = berlinParts('2026-07-15T09:30:00Z');
  assert.equal(p.hour, 11);
  assert.equal(p.weekday, 2); // Mi
  assert.equal(p.dateKey, '2026-07-15');
});

test('berlinParts: Tageswechsel über Mitternacht lokal', () => {
  // 2026-07-15T23:30:00Z → Berlin 2026-07-16 01:30
  const p = berlinParts('2026-07-15T23:30:00Z');
  assert.equal(p.dateKey, '2026-07-16');
  assert.equal(p.hour, 1);
});

// ─────────── tageSeit ───────────
test('tageSeit: ganze Tage', () => {
  const now = new Date('2026-07-15T12:00:00Z');
  assert.equal(tageSeit('2026-07-12T12:00:00Z', now), 3);
  assert.equal(tageSeit(null, now), null);
});

test('AMPEL_CONFIG: Schwellen zentral vorhanden', () => {
  assert.equal(AMPEL_CONFIG.keineBewerbungTage, 3);
  assert.ok(AMPEL_CONFIG.gelbRuecklaufFaktor > 0);
});
