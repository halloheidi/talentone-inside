// Header-basiertes Mapping Bewerbung -> Sheet-Zeile. Liest die Kopfzeile zur
// Laufzeit; ordnet Standard-Felder + Funnel-/Vorqual-Antworten per Fuzzy-Match
// den Spalten zu. Fehlende Werte = leere Zelle (nie Spaltenversatz).
//
// Schutz: vom Kunden gepflegte Spalten (Clivet: kontaktiert/Lebenslauf/Notiz/
// VG eingeladen/Eingestellt) werden NIE geschrieben. Die N&W-"kontaktiert am"-
// Spalte ist reserviert und wird nur bei der Vorqual-Rueckschreibung gefuellt
// (beim ersten Anhaengen bleibt sie leer). Nicht zuordenbare Funnel-Antworten
// landen in "weiteres".

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

// Vom Kunden gepflegt — NIE beschreiben. Regel: jede Spalte, die "clivet" nennt,
// plus die restlichen kundengepflegten Spalten per Alias (VG-Einladung, Lebenslauf,
// Notiz, Eingestellt). Bewusst grosszuegig, damit wir nie in Kundenspalten schreiben.
const CLIVET_OWNED = [
  'lebenslauf', 'notiz', 'eingestellt',
  'vg eingeladen', 'vorstellungsgespraech eingeladen', 'vorstellungsgesprach eingeladen', 'eingeladen am',
];
export const isClivetOwned = (header) => norm(header).includes('clivet') || matches(header, CLIVET_OWNED);
const isWeiteres = (header) => matches(header, ['weiteres', 'weitere antworten', 'sonstiges']);

// Reservierte N&W-"kontaktiert am"-Spalte: beim Append leer lassen, nur per
// Vorqual-Rueckschreibung fuellen. (Clivet-Variante ist bereits via isClivetOwned
// ausgeschlossen und wird hier nicht mehr erreicht.)
const NW_KONTAKTIERT = ['n&w telefonisch kontaktiert', 'n&w kontaktiert', 'telefonisch kontaktiert am', 'nw kontaktiert'];
const isNwKontaktiert = (header) => !isClivetOwned(header) && matches(header, NW_KONTAKTIERT);

// Standard-Felder (aus dem Bewerbungs-Datensatz, nicht aus Antworten).
// Wertunabhaengig definiert, damit "ist Standardfeld?" unabhaengig vom Kontext
// bestimmt werden kann.
const STANDARD_FIELDS = [
  { aliases: ['vor und nachname', 'vor- und nachname', 'name', 'vorname nachname'], get: c => c.name },
  { aliases: ['beworben am', 'eingang', 'eingegangen', 'bewerbungsdatum', 'datum'], get: c => c.datum },
  { aliases: ['tel nr', 'tel. nr', 'telefonnummer', 'handy', 'mobil', 'rufnummer', 'telefon'], get: c => c.telefon },
  { aliases: ['mail', 'e-mail', 'email', 'e mail'], get: c => c.email },
  { aliases: ['stelle', 'position', 'bewerbung fuer'], get: c => c.stelle },
  { aliases: ['quelle', 'source'], get: c => c.quelle },
];

// Reihenfolge: Reservierte/kundengepflegte Spalten haben Vorrang, damit z.B.
// "N&W telefonisch kontaktiert am" NICHT als Telefon-Standardfeld verstanden wird.
function standardField(header) {
  if (isClivetOwned(header) || isWeiteres(header) || isNwKontaktiert(header)) return null;
  return STANDARD_FIELDS.find(f => matches(header, f.aliases)) || null;
}
const isStandardHeader = (header) => standardField(header) !== null;

// Antwort-Wert flatten: Arrays/Mehrfachantworten -> ", "; Zeilenumbrueche -> "; ".
function flatten(v) {
  if (v == null) return '';
  const s = Array.isArray(v) ? v.filter(x => x != null && String(x).trim()).join(', ') : String(v);
  return s.replace(/\r?\n+/g, '; ').replace(/\s*;\s*;+/g, '; ').trim();
}

// Fragetext einer Antwort robust auslesen. Perspective liefert `frage_text`;
// andere Quellen ggf. `frage`/`label`/`key`.
const answerLabel = (a) => String(a?.frage_text ?? a?.frage ?? a?.label ?? a?.key ?? '');
const answerValue = (a) => flatten(a?.antwort ?? a?.value ?? a?.wert);

// Baut aus antworten[] (Funnel) + vorqual-werte{} eine einheitliche Paar-Liste.
export function toPairs({ antworten = [], vorqual = {} } = {}) {
  const pairs = [];
  for (const a of (Array.isArray(antworten) ? antworten : [])) {
    const key = answerLabel(a);
    if (key) pairs.push({ key, value: answerValue(a), kind: 'answer' });
  }
  for (const [k, v] of Object.entries(vorqual || {})) {
    if (k) pairs.push({ key: String(k), value: flatten(v), kind: 'vorqual' });
  }
  return pairs;
}

// Extrahiert die im Funnel gewaehlte Stelle aus den Antworten (Frage-Label-Match
// auf "Stelle"/"Position"/"Job"). Kein Treffer -> null (nicht raten). Der genaue
// Frage-Text ist funnel-abhaengig und beim ersten Probelead zu verifizieren.
export function extractStelle(antworten = []) {
  const list = Array.isArray(antworten) ? antworten : [];
  const strong = list.find(a => /stelle|position|stellenauswahl/i.test(answerLabel(a)) && answerValue(a));
  if (strong) return answerValue(strong);
  const weak = list.find(a => /\bjob\b/i.test(answerLabel(a)) && answerValue(a));
  return weak ? answerValue(weak) : null;
}

/**
 * Baut die Sheet-Zeile fuer eine NEUE Bewerbung, ausgerichtet an der Kopfzeile.
 * @returns {{ row: string[] }}
 */
export function buildAppendRow({ header = [], ctx = {}, pairs = [] } = {}) {
  const row = new Array(header.length).fill('');

  header.forEach((h, i) => {
    // Kundengepflegte, "weiteres"- und reservierte N&W-Spalten NIE beim Append fuellen.
    if (isClivetOwned(h) || isWeiteres(h) || isNwKontaktiert(h)) return;
    const std = standardField(h);
    if (std) {
      const v = std.get(ctx);
      row[i] = v == null ? '' : String(v);
      // Passende Antwort-Paare als "verbraucht" markieren (z.B. die Stellen-Frage,
      // deren Wert bereits in Spalte A steht) -> nicht zusaetzlich in "weiteres".
      pairs.forEach(p => { if (matches(h, [p.key])) p._used = true; });
      return;
    }
    // Fuzzy gegen Antwort-/Vorqual-Labels.
    const hit = pairs.find(p => matches(h, [p.key]));
    if (hit) { row[i] = hit.value || ''; hit._used = true; }
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
    if (isClivetOwned(h) || isWeiteres(h)) return;   // Kundenspalten strikt unberuehrt
    // N&W "telefonisch kontaktiert am": nur mit dem Kontaktdatum fuellen.
    if (isNwKontaktiert(h)) {
      if (nwKontaktiertAm) cells.push({ colIndex: i, value: nwKontaktiertAm });
      return;
    }
    if (isStandardHeader(h)) return;                 // Standardfelder nicht ueberschreiben
    const hit = pairs.find(p => matches(h, [p.key]));
    if (hit && hit.value) cells.push({ colIndex: i, value: hit.value });
  });
  return cells;
}
