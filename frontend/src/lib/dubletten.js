// Dubletten-Erkennung: dieselbe Person an derselben Stelle.
// Dublette = gleiche E-Mail (lowercase) ODER gleiche Telefonnummer
// (nur Ziffern, führende 0/+49 vereinheitlicht). Keine Zusammenführung —
// die Liste zeigt weiterhin alle Eingänge; gezählt werden eindeutige Personen.

export const normMail = s => (s || '').trim().toLowerCase();

// Telefon auf Ziffern reduzieren und Ländercode auf führende 0 normieren:
//  +49 170 / 0049 170 / 49170 / 0170  → alle „0170…".
export function normTel(s) {
  let d = String(s || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('0049')) d = '0' + d.slice(4);
  else if (d.startsWith('49')) d = '0' + d.slice(2);
  return d;
}

// Gruppiert Zeilen in eindeutige Personen. Zwei Zeilen sind dieselbe Person,
// wenn sie dieselbe job_id haben UND (gleiche E-Mail ODER gleiches Telefon).
// Union-Find, damit Ketten (Mail verbindet A–B, Telefon verbindet B–C) greifen.
export function personenGruppen(rows) {
  const parent = {};
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { parent[find(a)] = find(b); };
  for (const r of rows) parent[r.id] = r.id;
  const mailKey = {}, telKey = {};
  for (const r of rows) {
    const job = r.job_id ?? '_';
    const e = normMail(r.email);
    if (e) { const k = job + '|' + e; if (mailKey[k] != null) union(r.id, mailKey[k]); else mailKey[k] = r.id; }
    const tl = normTel(r.telefon);
    if (tl) { const k = job + '|' + tl; if (telKey[k] != null) union(r.id, telKey[k]); else telKey[k] = r.id; }
  }
  const groups = {};
  for (const r of rows) (groups[find(r.id)] ||= []).push(r);
  return Object.values(groups);
}

export const anzahlPersonen = rows => personenGruppen(rows).length;
