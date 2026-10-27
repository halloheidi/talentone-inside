import { randomUUID } from 'node:crypto';

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

/* ═══════════════════════════════════════════════════════════════════════════
   A4: Strukturierte Kriterien — EIGENE Spalte talentone_jobs.wichtige_kriterien_struktur.
   Bewusst getrennt von der Alt-Form oben (wichtige_kriterien, Vorqual-Feld-Invariante).
   Kanonische Form: { ko:[{id,text,aktiv}], muss:[...], wunsch:[...], hinweis_freitext,
     zuletzt_geaendert_von:'nw'|'kunde', zuletzt_geaendert_am }
   ═══════════════════════════════════════════════════════════════════════════ */

function _normItem(x) {
  if (x == null) return null;
  if (typeof x === 'string') { const t = x.trim(); return t ? { id: randomUUID(), text: t, aktiv: true } : null; }
  const text = (x.text ?? '').toString().trim();
  if (!text) return null;
  return { id: (x.id || randomUUID()).toString(), text, aktiv: x.aktiv === false ? false : true };
}
function _normListe(arr) { return Array.isArray(arr) ? arr.map(_normItem).filter(Boolean) : []; }

// Alt-Array [{kriterium,anforderung,pflicht}] → strukturiert (Fallback, falls struktur fehlt).
function _ausLegacyArray(arr) {
  const muss = [], wunsch = [];
  for (const e of arr) {
    const text = [e?.kriterium, e?.anforderung].map(s => (s ?? '').toString().trim()).filter(Boolean).join(' — ');
    if (!text) continue;
    (e?.pflicht === true ? muss : wunsch).push({ id: randomUUID(), text, aktiv: true });
  }
  return { ko: [], muss, wunsch };
}

/** Beliebigen Rohwert in die kanonische strukturierte Form bringen. */
export function normalizeKriterienStruktur(raw) {
  let ko = [], muss = [], wunsch = [], hinweis_freitext = '', von = null, am = null;
  if (Array.isArray(raw)) {
    const c = _ausLegacyArray(raw); ko = c.ko; muss = c.muss; wunsch = c.wunsch;
  } else if (raw && typeof raw === 'object') {
    ko = _normListe(raw.ko); muss = _normListe(raw.muss); wunsch = _normListe(raw.wunsch);
    hinweis_freitext = (raw.hinweis_freitext ?? '').toString();
    von = raw.zuletzt_geaendert_von ?? null; am = raw.zuletzt_geaendert_am ?? null;
  }
  return { ko, muss, wunsch, hinweis_freitext, zuletzt_geaendert_von: von, zuletzt_geaendert_am: am };
}

/** Onboarding-Pflicht erfüllt: mindestens 1 KO ODER 1 Muss (aktiv). */
export function kriterienErfuellt(struktur) {
  const n = (arr) => (arr || []).filter(i => i.aktiv !== false).length;
  return n(struktur?.ko) + n(struktur?.muss) >= 1;
}

/** Kompakter Diff fürs Log (je Kategorie Anzahl + hinzu/entfernt-Texte). */
export function diffKriterienStruktur(alt, neu) {
  const a = normalizeKriterienStruktur(alt), b = normalizeKriterienStruktur(neu);
  const diff = {};
  if ((a.hinweis_freitext || '') !== (b.hinweis_freitext || '')) diff.hinweis_geaendert = true;
  for (const kat of ['ko', 'muss', 'wunsch']) {
    const altT = new Set(a[kat].map(i => i.text)), neuT = new Set(b[kat].map(i => i.text));
    const hinzu = b[kat].filter(i => !altT.has(i.text)).map(i => i.text);
    const entfernt = a[kat].filter(i => !neuT.has(i.text)).map(i => i.text);
    if (hinzu.length || entfernt.length || a[kat].length !== b[kat].length) {
      diff[kat] = { vorher: a[kat].length, nachher: b[kat].length, hinzu, entfernt };
    }
  }
  return diff;
}

/** Eingehende (Teil-)Kriterien kanonisieren + Metadaten setzen. */
export function prepareKriterienStrukturWrite(body, von) {
  const n = normalizeKriterienStruktur(body);
  n.zuletzt_geaendert_von = von === 'kunde' ? 'kunde' : 'nw';
  n.zuletzt_geaendert_am = new Date().toISOString();
  return n;
}
