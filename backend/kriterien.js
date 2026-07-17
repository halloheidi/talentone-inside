// "Worauf achten wir?" — wichtige Kriterien pro Stelle + die daraus abgeleitete
// Spaltenlogik für die Kunden-Ansicht.
//
// Regel (bewusst zweiteilig):
//   1. Befüllte Vorqual-Felder erscheinen beim Kunden als Spalte.
//   2. Als wichtig markierte Kriterien erscheinen IMMER — auch wenn noch leer
//      (dann "—"). So sieht der Kunde, dass genau diese Punkte geprüft werden.

/** Normalisiert die Kriterien-Liste eines Jobs. */
export function normalizeKriterien(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(k => ({
      kriterium:   String(k?.kriterium ?? '').trim(),
      anforderung: String(k?.anforderung ?? '').trim() || null,
      pflicht:     !!k?.pflicht,
    }))
    .filter(k => k.kriterium);
}

/** Namen der wichtigen Kriterien (= Spalten, die immer sichtbar sind). */
export function kriterienNamen(job) {
  return normalizeKriterien(job?.wichtige_kriterien).map(k => k.kriterium);
}

/**
 * Welche Vorqual-Spalten sieht der Kunde?
 *
 * @param {object} p
 *   felder   — effektive Vorqual-Felder des Jobs ([{name, typ, optionen}])
 *   werte    — Array aller vorqualifizierung_werte-Objekte (pro Bewerbung)
 *   kriterien— wichtige Kriterien des Jobs (Namen)
 * @returns {Array<{name, wichtig}>} Spalten in stabiler Reihenfolge:
 *          erst die wichtigen Kriterien, dann die übrigen befüllten Felder.
 */
export function kundenVorqualSpalten({ felder = [], werte = [], kriterien = [] }) {
  const hatWert = (name) => werte.some(w => {
    const v = w?.[name];
    return v != null && String(v).trim() !== '';
  });

  const wichtig = new Set(kriterien.map(k => String(k).trim()).filter(Boolean));
  const feldNamen = felder.map(f => f?.name).filter(Boolean);

  const spalten = [];
  // 1) Wichtige Kriterien immer — auch ohne Wert. Reihenfolge = Kriterien-Reihenfolge.
  for (const name of kriterien) {
    const n = String(name).trim();
    if (!n || spalten.some(s => s.name === n)) continue;
    spalten.push({ name: n, wichtig: true });
  }
  // 2) Übrige Vorqual-Felder nur, wenn irgendwo befüllt.
  for (const name of feldNamen) {
    if (wichtig.has(name) || spalten.some(s => s.name === name)) continue;
    if (hatWert(name)) spalten.push({ name, wichtig: false });
  }
  return spalten;
}
