// Schlanker Google-Sheets-v4-Client — ohne googleapis-Dependency.
// Auth: Service-Account-JWT (RS256, via jsonwebtoken) -> OAuth-Access-Token ->
// REST-Calls per fetch. Credentials liegen als GOOGLE_SERVICE_ACCOUNT_JSON
// (kompletter JSON-Key) in der VPS-.env.
//
// Bewusst append-only + gezielte Zell-Updates: wir fassen nie ganze Bereiche an,
// damit vom Kunden gepflegte Spalten unberuehrt bleiben.

import jwt from 'jsonwebtoken';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

let _creds = null;      // geparste Service-Account-JSON
let _token = null;      // { access_token, exp } — im Prozess gecacht

function creds() {
  if (_creds) return _creds;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON nicht gesetzt.');
  _creds = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!_creds.client_email || !_creds.private_key) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON unvollstaendig (client_email/private_key fehlt).');
  }
  return _creds;
}

/** Ist der Sync ueberhaupt konfiguriert? (Kein Fehler, wenn nicht.) */
export function isConfigured() {
  return !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
}

/** E-Mail des Service Accounts — die Adresse, fuer die das Sheet freigegeben wird. */
export function serviceAccountEmail() {
  try { return creds().client_email; } catch { return null; }
}

// Access-Token holen (gecacht bis kurz vor Ablauf). Nutzt Date.now nicht direkt,
// sondern die exp-Claim im Token; im Prozess reicht ein simpler Zeitvergleich.
async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (_token && _token.exp - 60 > now) return _token.access_token;

  const c = creds();
  const assertion = jwt.sign(
    { iss: c.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 },
    c.private_key,
    { algorithm: 'RS256' },
  );
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Google-OAuth ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  _token = { access_token: j.access_token, exp: now + (j.expires_in || 3600) };
  return _token.access_token;
}

async function api(path, { method = 'GET', body } = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${SHEETS_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Sheets-API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// Bereich mit (evtl. leerem) Tabellenblatt-Namen bauen. Leerer Name -> erstes Blatt.
function a1(sheetName, range) {
  if (!sheetName) return range;
  return `'${String(sheetName).replace(/'/g, "''")}'!${range}`;
}

/** Titel des ersten Tabellenblatts (wenn sheet_name leer gelassen wird). */
export async function firstSheetName(spreadsheetId) {
  const j = await api(`/${spreadsheetId}?fields=sheets.properties.title`);
  return j.sheets?.[0]?.properties?.title || null;
}

/** Kopfzeile (Zeile 1) lesen — Basis fuer das header-basierte Mapping. */
export async function readHeaderRow(spreadsheetId, sheetName) {
  const range = encodeURIComponent(a1(sheetName, '1:1'));
  const j = await api(`/${spreadsheetId}/values/${range}`);
  return (j.values && j.values[0]) || [];
}

/** Alle Werte eines Bereichs lesen (z.B. fuer Backfill-Abgleich). */
export async function readValues(spreadsheetId, sheetName, range = 'A:Z') {
  const r = encodeURIComponent(a1(sheetName, range));
  const j = await api(`/${spreadsheetId}/values/${r}`);
  return j.values || [];
}

/** Eine Zeile ans Ende anhaengen. Gibt die 1-basierte Zeilennummer zurueck. */
export async function appendRow(spreadsheetId, sheetName, valuesRow) {
  const range = encodeURIComponent(a1(sheetName, 'A1'));
  const j = await api(
    `/${spreadsheetId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: { values: [valuesRow] } },
  );
  // updatedRange z.B. "Bewerbungen!A57:W57" -> Zeilennummer aus dem Ende ziehen.
  const updated = j.updates?.updatedRange || '';
  const m = updated.match(/![A-Z]+(\d+):/);
  return m ? Number(m[1]) : null;
}

/** Gezielte Zellen aktualisieren: [{ colIndex(0-basiert), value }] in einer Zeile.
 *  Schreibt NUR die genannten Spalten (nie zusammenhaengende Bereiche) — so
 *  bleiben vom Kunden gepflegte Nachbarspalten unberuehrt. */
export async function updateCells(spreadsheetId, sheetName, rowNumber, cells) {
  const data = cells
    .filter(c => Number.isInteger(c.colIndex) && c.colIndex >= 0)
    .map(c => ({
      range: a1(sheetName, `${colLetter(c.colIndex)}${rowNumber}`),
      values: [[c.value == null ? '' : String(c.value)]],
    }));
  if (!data.length) return;
  await api(`/${spreadsheetId}/values:batchUpdate`, {
    method: 'POST',
    body: { valueInputOption: 'RAW', data },
  });
}

// 0-basierter Spaltenindex -> A1-Buchstabe (0->A, 25->Z, 26->AA).
export function colLetter(i) {
  let s = '';
  let n = i;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}
