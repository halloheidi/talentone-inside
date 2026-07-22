// Regression: Der Erstversand der Entwuerfe darf NIE an resend_mode scheitern.
//
// Hintergrund: Frontend schickt beim Erstversand resend_mode='first'. Frueher
// lehnte der Endpoint jeden nicht-'new_round'/'same_round'-Wert mit 400 ab
// ("resend_mode muss ...") -> Erstversand blockiert (Tuskulum + Klimapartner).
// Jetzt ist resend_mode nur ein Hinweis; die Variante kommt aus dem DB-Zustand.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeResendMode, resolveVersandVariante } from '../versand-variante.js';

test("normalizeResendMode: 'first'/leer/unbekannt -> null (nie hart abgelehnt)", () => {
  assert.equal(normalizeResendMode('first'), null);
  assert.equal(normalizeResendMode(undefined), null);
  assert.equal(normalizeResendMode(''), null);
  assert.equal(normalizeResendMode('irgendwas'), null);
  // Nur diese beiden tragen Bedeutung:
  assert.equal(normalizeResendMode('new_round'), 'new_round');
  assert.equal(normalizeResendMode('same_round'), 'same_round');
});

test("Erstversand ohne resend_mode + noch nie versandt -> 'erstversand'", () => {
  const variante = resolveVersandVariante({
    resendHint: normalizeResendMode(undefined), hatteVersand: false,
  });
  assert.equal(variante, 'erstversand');
});

test("Erstversand: Frontend schickt 'first' -> trotzdem 'erstversand' (kein Fehler)", () => {
  const variante = resolveVersandVariante({
    resendHint: normalizeResendMode('first'), hatteVersand: false,
  });
  assert.equal(variante, 'erstversand');
});

test("Erstversand gewinnt IMMER — auch wenn Client faelschlich 'new_round' schickt", () => {
  const variante = resolveVersandVariante({
    resendHint: normalizeResendMode('new_round'), hatteVersand: false, hatKundenReaktion: true,
  });
  assert.equal(variante, 'erstversand');
});

test("neue Runde nur mit Vorversand + echter Kundenreaktion + 'new_round'", () => {
  assert.equal(
    resolveVersandVariante({ resendHint: 'new_round', hatteVersand: true, hatKundenReaktion: true }),
    'neue_runde',
  );
});

test("'new_round' ohne Kundenreaktion -> 'resend' (keine Schein-Runde)", () => {
  assert.equal(
    resolveVersandVariante({ resendHint: 'new_round', hatteVersand: true, hatKundenReaktion: false }),
    'resend',
  );
});

test("Vorversand ohne Hinweis -> 'resend' (gleiche Runde erneut)", () => {
  assert.equal(
    resolveVersandVariante({ resendHint: null, hatteVersand: true, hatKundenReaktion: true }),
    'resend',
  );
});
