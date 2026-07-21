// Header-basiertes Mapping Bewerbung -> Sheet-Zeile. Liest die Kopfzeile zur
// Laufzeit; ordnet Standard-Felder + Funnel-/Vorqual-Antworten per Fuzzy-Match
// den Spalten zu. Fehlende Werte = leere Zelle (nie Spaltenversatz).
//
// Schutz: vom Kunden gepflegte Spalten (Clivet: kontaktiert/Lebenslauf/Notiz/
// VG eingeladen/Eingestellt) werden NIE geschrieben. Nicht zuordenbare Funnel-
// Antworten landen in "weiteres" (nur beim ersten Anhaengen, nie beim Update).

function norm(s) {
  return String(s || '').toLowerCase()
    .replace(/[.:()\/\-–—]/g, ' ')
    .replace(/[äöü]/g, m => ({ ä: 'ae', ö: 'oe', ü: 'ue' }[m]))
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, ' ').trim();
}

// Fuzzy: exakt, oder Teilstring in beide Richtungen (case-/diakritik-insensitiv).
function matches(header, aliases) {
  const h = norm(header);
  if (!h) return false;
  return aliases.some(a => { const n = norm(a); return n && (h === n || h.includes(n) || n.includes(h)); });
}

// Vom Kunden gepflegt — NIE beschreiben.
const CLIVET_OWNED = ['clivet kontaktiert', 'lebenslauf', 'notiz', 'vg eingeladen', 'eingestellt'];
export const isClivetOwned = (header) => matches(header, CLIVET_OWNED);
const isWeiteres = (header) => matches(header, ['weiteres', 'weitere antworten', 'sonstiges']);

// Standard-Felder (aus dem Bewerbungs-Datensatz, nicht aus Antworten).
function standardValue(header, ctx) {
  if (matches(header, ['vor und nachname', 'vor- und nachname', 'name', 'vorname nachname'])) return ctx.name;
  if (matches(header, ['beworben am', 'eingang', 'eingegangen', 'datum', 'bewerbungsdatum'])) return ctx.datum;
  if (matches(header, ['tel nr', 'tel. nr', 'telefon', 'telefonnummer', 'handy', 'mobil', 'rufnummer'])) return ctx.telefon;
  if (matches(header, ['mail', 'e-mail', 'email', 'e mail'])) return ctx.email;
  if (matches(header, ['stelle', 'position', 'job', 'bewerbung fuer'])) return ctx.stelle;
  if (matches(header, ['quelle', 'source'])) return ctx.quelle;
  return undefined; // kein Standard-Feld
}

// Antwort-Wert flatten: Arrays/Mehrfachantworten -> ", "; Zeilenumbrueche -> "; ".
function flatten(v) {
  if (v == null) return '';
  const s = Array.isArray(v) ? v.filter(x => x != null && String(x).trim()).join(', ') : String(v);
  return s.replace(/\r?\n+/g, '; ').replace(/\s*;\s*;+/g, '; ').trim();
}

// Baut aus antworten[] (Funnel) + vorqual-werte{} eine einheitliche Paar-Liste.
export function toPairs({ antworten = [], vorqual = {} } = {}) {
  const pairs = [];
  for (const a of (Array.isArray(antworten) ? antworten : [])) {
    const key = a?.frage ?? a?.label ?? a?.key;
    if (key) pairs.push({ key: String(key), value: flatten(a?.antwort ?? a?.value ?? a?.wert), kind: 'answer' });
  }
  for (const [k, v] of Object.entries(vorqual || {})) {
    if (k) pairs.push({ key: String(k), value: flatten(v), kind: 'vorqual' });
  }
  return pairs;
}

/**
 * Baut die Sheet-Zeile fuer eine NEUE Bewerbung, ausgerichtet an der Kopfzeile.
 * @returns {{ row: string[] }}
 */
export function buildAppendRow({ header = [], ctx = {}, pairs = [] } = {}) {
  const row = new Array(header.length).fill('');
  const usedIdx = new Set();

  header.forEach((h, i) => {
    if (isClivetOwned(h) || isWeiteres(h)) return; // spaeter / nie
    const std = standardValue(h, ctx);
    if (std !== undefined) { row[i] = std == null ? '' : String(std); usedIdx.add(i); return; }
    // Fuzzy gegen Antwort-/Vorqual-Labels.
    const hit = pairs.find(p => matches(h, [p.key]));
    if (hit) { row[i] = hit.value || ''; usedIdx.add(i); hit._used = true; }
  });

  // Nicht zugeordnete Funnel-Antworten -> "weiteres"-Spalte (nur Answers).
  const rest = pairs.filter(p => !p._used && p.kind === 'answer' && p.value)
    .map(p => `${p.key}: ${p.value}`).join(' | ');
  if (rest) {
    const wIdx = header.findIndex(h => isWeiteres(h));
    if (wIdx >= 0) row[wIdx] = rest;
    else row.push(rest); // keine "weiteres"-Spalte -> ans Zeilenende
  }
  return { row };
}

/**
 * Baut die Zell-Updates fuer die Vorqual-Rueckschreibung in eine BESTEHENDE Zeile.
 * NUR Vorqual/N&W-Spalten; Standard-, Clivet- und "weiteres"-Spalten unberuehrt.
 * @returns {Array<{colIndex:number, value:string}>}
 */
export function buildVorqualUpdateCells({ header = [], vorqual = {}, nwKontaktiertAm = null } = {}) {
  const pairs = toPairs({ vorqual });
  const cells = [];
  header.forEach((h, i) => {
    if (isClivetOwned(h) || isWeiteres(h)) return;
    if (standardValue(h, {}) !== undefined) return; // Standardfeld nicht ueberschreiben
    // N&W telefonisch kontaktiert am:
    if (matches(h, ['n&w telefonisch kontaktiert', 'n w telefonisch kontaktiert', 'telefonisch kontaktiert am', 'nw kontaktiert'])) {
      if (nwKontaktiertAm) cells.push({ colIndex: i, value: nwKontaktiertAm });
      return;
    }
    const hit = pairs.find(p => matches(h, [p.key]));
    if (hit && hit.value) cells.push({ colIndex: i, value: hit.value });
  });
  return cells;
}
