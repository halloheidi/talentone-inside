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
 * Brief-Anrede ohne Komma — die EINZIGE Quelle jeder Begrüßungszeile.
 *   du  → "Hallo Uwe"          (nur Vorname; nie Vorname+Nachname; ohne Namen: "Hallo")
 *   sie → "Hallo Herr Junk"    (Titel + Nachname)
 *        Fallback ohne Nachname: voller Ansprechpartner-Name ("Hallo Nadine Bizjak"),
 *        ganz ohne Namen: "Guten Tag".
 */
export function anrede(kunde) {
  if (anredeForm(kunde) === 'sie') {
    const titel = kunde?.anrede_titel === 'frau' ? 'Frau'
      : kunde?.anrede_titel === 'herr' ? 'Herr' : null;
    const nach = (kunde?.nachname || '').trim() || nachnameAus(kunde?.ansprechpartner);
    if (titel && nach) return `Hallo ${titel} ${nach}`;
    // Fallback NUR bei fehlendem Nachnamen: voller Ansprechpartner-Name.
    if (!nach) {
      const voll = String(kunde?.ansprechpartner || '').trim();
      if (voll) return `Hallo ${voll}`;
    }
    return 'Guten Tag';
  }
  const vor = vornameAus(kunde?.ansprechpartner);
  return vor ? `Hallo ${vor}` : 'Hallo';
}

// Erkennt eine führende Grußformel (erste nicht-leere Zeile). Deckt {{anrede}}
// (noch nicht ersetzt) sowie die üblichen deutschen Anreden ab.
const GRUSS_RE = /^[^\S\r\n]*(?:\{\{\s*anrede\s*\}\}|(?:hallo|hi|hey|moin|servus|liebe(?:r|s)?|guten\s+(?:tag|morgen|abend)|sehr\s+geehrte(?:r|s)?(?:\s+damen\s+und\s+herren)?)\b)[^\r\n]*(?:\r?\n)?/i;

/** true, wenn der Text mit einer Grußzeile beginnt (für die Speicher-Warnung). */
export function startsWithGreeting(text) {
  return GRUSS_RE.test(String(text ?? ''));
}

/**
 * Entfernt eine führende Grußzeile (inkl. der folgenden Leerzeile), damit die
 * zentrale Anrede nie doppelt erscheint. Ohne Grußzeile bleibt der Text
 * unverändert (auch der Typ: gibt dann den Originalwert zurück).
 */
export function stripLeadingGreeting(text) {
  const s = String(text ?? '');
  if (!GRUSS_RE.test(s)) return text;
  return s.replace(GRUSS_RE, '').replace(/^\s+/, '');
}

/**
 * Erkennt regelbasiert, ob ein Mailtext DUZT oder SIEZT. Grußzeile stark gewichtet,
 * Du-Pronomen klein + Wortgrenze, Sie-Formen großgeschrieben (unterscheidet vom
 * „sie" = они/sie). @returns 'du' | 'sie' | null (kein klares Signal).
 */
export function erkenneAnredeAusText(text) {
  if (!text) return null;
  const roh = String(text).slice(0, 2500);
  const lower = roh.toLowerCase();
  let du = 0, sie = 0;
  const ersteZeile = (roh.split(/\r?\n/).find(l => l.trim()) || '').trim().toLowerCase();
  if (/^(hallo|hi|hey|moin|servus|liebe[rs]?)\b/.test(ersteZeile) && !/sehr geehrte/.test(ersteZeile) && !/^hallo (herr|frau)\b/.test(ersteZeile)) du += 3;
  if (/^(sehr geehrte|guten (tag|morgen|abend)|hallo (herr|frau))\b/.test(ersteZeile)) sie += 3;
  du += (lower.match(/\b(du|dich|dir|dein|deine|deinen|deinem|deiner|deines)\b/g) || []).length;
  sie += (roh.match(/\b(Sie|Ihnen|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)\b/g) || []).length;
  if (/sehr geehrte/i.test(roh)) sie += 2;
  if (du > sie) return 'du';
  if (sie > du) return 'sie';
  return null;
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
