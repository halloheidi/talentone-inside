// "Worauf achten wir?" — wichtige Kriterien pro Stelle.
//
// KERN-INVARIANTE: Jedes Kriterium referenziert GENAU EIN Vorqual-Feld.
// Ein Kriterium dupliziert also nie eine Spalte, sondern markiert ein
// bestehendes Feld und ergaenzt es um Metadaten (anforderung + pflicht).
// Trifft ein Kriterium auf kein Feld (echtes Neuland, z. B. "Schwindelfreiheit"),
// wird automatisch ein gleichnamiges Feld am Job erzeugt — so bleibt die
// Invariante immer erhalten.
//
// Schema: { kriterium: <Feldname>, anforderung: "Klasse B"|null, pflicht: bool }
//
// Spaltenlogik fuer die Kunden-Ansicht (bewusst zweiteilig):
//   1. Befuellte Vorqual-Felder erscheinen als Spalte.
//   2. Als wichtig markierte Kriterien erscheinen IMMER — auch leer ("—").

/** Vergleichsform: klein, ohne Umlaute/Sonderzeichen. */
export function normFeldname(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Fuzzy-Match eines Kriterium-Namens auf ein bestehendes Feld.
 * "Führerschein B" → "Führerschein" (Feldname steckt im Kriterium).
 * Gibt den ORIGINAL-Feldnamen zurueck oder null.
 */
export function matchFeld(name, feldNamen = []) {
  const n = normFeldname(name);
  if (!n) return null;
  const kandidaten = feldNamen.filter(Boolean);

  // 1) Exakt (normalisiert)
  const exakt = kandidaten.find(f => normFeldname(f) === n);
  if (exakt) return exakt;

  // 2) Teilstring in beide Richtungen — laengster Treffer gewinnt, damit
  //    "Gehaltsvorstellung (brutto)" nicht faelschlich an "Gehalt" haengt.
  const treffer = kandidaten
    .filter(f => {
      const fn = normFeldname(f);
      return fn.length >= 4 && (n.includes(fn) || fn.includes(n));
    })
    .sort((a, b) => normFeldname(b).length - normFeldname(a).length);
  return treffer[0] || null;
}

/** Normalisiert die Kriterien-Liste (ohne Feld-Abgleich). */
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

/**
 * Stellt die Invariante her: jedes Kriterium zeigt auf genau ein Feld.
 * - passt Kriterien per Fuzzy-Match auf bestehende Feldnamen an
 * - legt fuer echtes Neuland ein neues Textfeld an
 * - dedupliziert: pro Feld hoechstens ein Kriterium (spaeteres gewinnt)
 *
 * @returns {{kriterien: Array, felder: Array}} beide fertig zum Speichern
 */
export function syncKriterienMitFeldern({ kriterien = [], felder = [] }) {
  const outFelder = (Array.isArray(felder) ? felder : []).filter(f => f?.name);
  const byFeld = new Map(); // Feldname → Kriterium

  for (const k of normalizeKriterien(kriterien)) {
    const treffer = matchFeld(k.kriterium, outFelder.map(f => f.name));
    let feldName;
    if (treffer) {
      feldName = treffer;
    } else {
      // Echtes Neuland → gleichnamiges Feld anlegen, Kriterium zeigt darauf.
      feldName = k.kriterium;
      outFelder.push({ name: feldName, typ: 'text' });
    }
    byFeld.set(feldName, { ...k, kriterium: feldName });
  }

  return { kriterien: [...byFeld.values()], felder: outFelder };
}

/** Namen der wichtigen Kriterien (= Spalten, die immer sichtbar sind). */
export function kriterienNamen(job) {
  return normalizeKriterien(job?.wichtige_kriterien).map(k => k.kriterium);
}

/**
 * Welche Vorqual-Spalten sieht der Kunde?
 * @returns {Array<{name, wichtig, anforderung, pflicht}>}
 *   erst die wichtigen Kriterien, dann die uebrigen befuellten Felder.
 */
export function kundenVorqualSpalten({ felder = [], werte = [], kriterien = [] }) {
  const hatWert = (name) => werte.some(w => {
    const v = w?.[name];
    return v != null && String(v).trim() !== '';
  });

  const kriterienListe = normalizeKriterien(
    kriterien.map(k => (typeof k === 'string' ? { kriterium: k } : k))
  );
  const wichtig = new Set(kriterienListe.map(k => k.kriterium));
  const spalten = [];

  // 1) Wichtige Kriterien immer — auch ohne Wert.
  for (const k of kriterienListe) {
    if (spalten.some(s => s.name === k.kriterium)) continue;
    spalten.push({ name: k.kriterium, wichtig: true, anforderung: k.anforderung, pflicht: k.pflicht });
  }
  // 2) Uebrige Vorqual-Felder nur, wenn irgendwo befuellt.
  for (const f of felder) {
    const name = f?.name;
    if (!name || wichtig.has(name) || spalten.some(s => s.name === name)) continue;
    if (hatWert(name)) spalten.push({ name, wichtig: false, anforderung: null, pflicht: false });
  }
  return spalten;
}
