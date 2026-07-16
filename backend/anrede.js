// Zentrale Anrede-Logik (Du/Sie + Herr/Frau) für ALLE kundengerichteten Texte.
//
// Regel: Jede Mail / Public-Seite spricht durchgängig EINE Form. Nie mischen.
// Interne Mails (an unser Team) bleiben immer Du und nutzen diesen Helper nicht.
//
// anrede_form: 'du' | 'sie' | null (null = noch nicht festgelegt)
// anrede_titel: 'herr' | 'frau' (nur bei 'sie')
//
// WICHTIG: Dieselbe Logik existiert 1:1 in frontend/src/lib/anrede.js
// (getrennte Bundles). Änderungen bitte in beiden Dateien.

/** Vorname aus "Marc Petersen" → "Marc". */
export function vornameAus(ansprechpartner) {
  const s = String(ansprechpartner || '').trim();
  if (!s) return null;
  return s.split(/\s+/)[0] || null;
}

/** Nachname aus "Marc Petersen" → "Petersen" (letztes Token). */
export function nachnameAus(ansprechpartner) {
  const s = String(ansprechpartner || '').trim();
  if (!s) return null;
  const teile = s.split(/\s+/);
  return teile.length > 1 ? teile[teile.length - 1] : null;
}

/**
 * Gewählte Form. Fallback 'du', solange nichts festgelegt ist — vor dem Versand
 * wird die Form ohnehin abgefragt; der Fallback greift nur beim Rendern
 * (z. B. Public-Seiten von Bestandskunden).
 */
export function anredeForm(kunde) {
  return kunde?.anrede_form === 'sie' ? 'sie' : 'du';
}

/** true, wenn die Anrede noch nie festgelegt wurde (→ Abfrage vor Versand). */
export function anredeOffen(kunde) {
  return !kunde?.anrede_form;
}

/**
 * Brief-Anrede ohne Komma:
 *   du  → "Hallo Uwe"        (Vorname; ohne Namen: "Hallo")
 *   sie → "Hallo Herr Junk"  (Titel + Nachname; ohne Titel/Namen: "Guten Tag")
 */
export function anrede(kunde) {
  if (anredeForm(kunde) === 'sie') {
    const titel = kunde?.anrede_titel === 'frau' ? 'Frau'
      : kunde?.anrede_titel === 'herr' ? 'Herr' : null;
    const nach = (kunde?.nachname || '').trim() || nachnameAus(kunde?.ansprechpartner);
    if (titel && nach) return `Hallo ${titel} ${nach}`;
    return 'Guten Tag';
  }
  const vor = vornameAus(kunde?.ansprechpartner);
  return vor ? `Hallo ${vor}` : 'Hallo';
}

/** Wählt zwischen zwei Formulierungen: t(kunde, "dein Funnel", "Ihr Funnel"). */
export function t(kunde, duText, sieText) {
  return anredeForm(kunde) === 'sie' ? sieText : duText;
}

/** Für KI-Prompts: "Du-Anrede (duzen)" / "Sie-Anrede (siezen)". */
export function anredePromptHinweis(kunde) {
  return anredeForm(kunde) === 'sie'
    ? 'Sie-Anrede (siezen, höflich aber locker)'
    : 'Du-Anrede (duzen, locker und persönlich)';
}
