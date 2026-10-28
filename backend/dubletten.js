// Dubletten-Erkennung (Serverseite) — identische Logik wie frontend/src/lib/dubletten.js.
// Dublette = gleiche Person an derselben Stelle: gleiche E-Mail (lowercase)
// ODER gleiche Telefonnummer (nur Ziffern, führende 0/+49 vereinheitlicht).
// Rein zählend/lesend — ändert keine Daten.

export const normMail = s => (s || '').trim().toLowerCase();

export function normTel(s) {
  let d = String(s || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('0049')) d = '0' + d.slice(4);
  else if (d.startsWith('49')) d = '0' + d.slice(2);
  return d;
}

// Gruppiert Zeilen in eindeutige Personen (Union-Find, pro job_id, Mail ODER Telefon).
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
