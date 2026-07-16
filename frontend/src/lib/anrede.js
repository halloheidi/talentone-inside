// Zentrale Anrede-Logik (Du/Sie + Herr/Frau) für kundengerichtete Texte im
// Frontend (Public-Seiten, Modal-Vorbelegungen, Hinweise).
//
// WICHTIG: Dieselbe Logik existiert 1:1 in backend/anrede.js (getrennte
// Bundles). Änderungen bitte in beiden Dateien.

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

export function anredeForm(kunde) {
  return kunde?.anrede_form === 'sie' ? 'sie' : 'du';
}

/** true, wenn die Anrede noch nie festgelegt wurde (→ Abfrage vor Versand). */
export function anredeOffen(kunde) {
  return !kunde?.anrede_form;
}

/**
 * Brief-Anrede ohne Komma:
 *   du  → "Hallo Uwe" / sie → "Hallo Herr Junk"
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

/** Kurzlabel für den Hinweis in Versand-Modals: "per Du (Uwe)". */
export function anredeLabel(kunde) {
  if (!kunde?.anrede_form) return null;
  if (kunde.anrede_form === 'sie') {
    const titel = kunde.anrede_titel === 'frau' ? 'Frau' : kunde.anrede_titel === 'herr' ? 'Herr' : '';
    const nach = (kunde.nachname || '').trim() || nachnameAus(kunde.ansprechpartner) || '';
    return `per Sie${titel || nach ? ` (${[titel, nach].filter(Boolean).join(' ')})` : ''}`;
  }
  const vor = vornameAus(kunde.ansprechpartner);
  return `per Du${vor ? ` (${vor})` : ''}`;
}
