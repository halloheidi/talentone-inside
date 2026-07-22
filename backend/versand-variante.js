// Reine Logik fuer den Entwurfs-Versand: welche Variante gilt — abgeleitet aus
// dem ECHTEN Zustand (ging schon mal ein Entwurf raus? hat der Kunde reagiert?),
// NICHT aus der Client-Absicht. So ist der Erstversand ein eigener, legitimer
// Zustand und kann nie hart abgelehnt werden.
//
// resend_mode ist nur ein optionaler UI-Hinweis. Bedeutung tragen ausschliesslich
// 'new_round' und 'same_round'; alles andere (inkl. 'first', leer, fehlend, alter
// Cache, Unsinn) wird zu null normalisiert — es gibt KEINEN Validierungsfehler,
// der den Erstversand blockiert.

export function normalizeResendMode(resend_mode) {
  return (resend_mode === 'new_round' || resend_mode === 'same_round') ? resend_mode : null;
}

/**
 * @returns {'erstversand'|'resend'|'neue_runde'}
 *  - erstversand : es ging noch nie ein Entwurf raus (gewinnt IMMER)
 *  - neue_runde  : Vorversand + echte Kundenreaktion + Hinweis 'new_round'
 *  - resend      : sonst (gleiche Runde nochmal)
 */
export function resolveVersandVariante({ resendHint = null, hatteVersand = false, hatKundenReaktion = false } = {}) {
  if (!hatteVersand) return 'erstversand';
  if (resendHint === 'new_round' && hatKundenReaktion) return 'neue_runde';
  return 'resend';
}
