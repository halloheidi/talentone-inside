// Normalisiert eine Bewerbung, deren antworten[] noch rohe Perspective-Payload-Keys
// (profile / values / titles / meta / …) enthalten. Liefert ein sauberes
// { name, email, telefon, antworten:[{frage_text, antwort}] }.

const META_KEYS = new Set([
  'id', 'funnelid', 'funnelname', 'meta', 'values', 'titles',
  'trackingversion', 'profile', 'createdat', 'updatedat',
]);

function tryParseJson(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return null;
  try { return JSON.parse(t); } catch { return null; }
}

function pickValue(node) {
  if (node == null) return null;
  if (typeof node === 'object') {
    if ('value' in node && typeof node.value !== 'object') return node.value;
    return null;
  }
  return node;
}

function joinName(first, last) {
  return [first, last].filter(Boolean).map(s => String(s).trim()).filter(Boolean).join(' ').trim();
}

// Liefert profile/values aus den vorhandenen rohen antworten-Einträgen
function extractRawObjects(antworten) {
  let profile = null;
  let values = null;
  for (const a of antworten || []) {
    const key = (a?.frage_text || '').toString().trim().toLowerCase();
    if (key === 'profile' && !profile) {
      const obj = typeof a.antwort === 'object' ? a.antwort : tryParseJson(a.antwort);
      if (obj && typeof obj === 'object') profile = obj;
    } else if (key === 'values' && !values) {
      const obj = typeof a.antwort === 'object' ? a.antwort : tryParseJson(a.antwort);
      if (obj && typeof obj === 'object') values = obj;
    }
  }
  return { profile, values };
}

export function normalizeBewerbung(bewerbung) {
  if (!bewerbung) return { name: null, email: null, telefon: null, antworten: [] };

  const rawAntworten = Array.isArray(bewerbung.antworten) ? bewerbung.antworten : [];

  // Wenn keiner der Einträge ein Meta-Key ist UND keine Antwort JSON-Roh-Object enthält,
  // dann ist alles bereits sauber → direkt zurückgeben.
  const hasMetaKey = rawAntworten.some(a => META_KEYS.has((a?.frage_text || '').toString().trim().toLowerCase()));
  const hasRawJson = rawAntworten.some(a => typeof a?.antwort === 'string' && /^\s*[{[]/.test(a.antwort));

  if (!hasMetaKey && !hasRawJson) {
    return {
      name: bewerbung.name || null,
      email: bewerbung.email || null,
      telefon: bewerbung.telefon || null,
      antworten: rawAntworten.filter(a => a && (a.antwort ?? '') !== ''),
    };
  }

  // Rohes Perspective-Schema rekonstruieren
  const { profile, values } = extractRawObjects(rawAntworten);
  const prof = profile || {};
  const vals = values || {};

  const name =
    bewerbung.name ||
    pickValue(prof.name) || pickValue(prof.fullName) || pickValue(prof.full_name) ||
    vals.name || vals.fullName || vals.full_name ||
    joinName(pickValue(prof.first_name), pickValue(prof.last_name)) ||
    joinName(vals.first_name, vals.last_name) ||
    null;

  const email =
    bewerbung.email ||
    pickValue(prof.email) || vals.email || null;

  const telefon =
    bewerbung.telefon ||
    pickValue(prof.phone) || pickValue(prof.telefon) ||
    vals.phone || vals.telefon || null;

  // Antworten aus profile.question_*
  const antworten = [];
  for (const [k, v] of Object.entries(prof)) {
    if (!k.startsWith('question_')) continue;
    if (!v || typeof v !== 'object') continue;
    const frage = v.title || v.label || k;
    const antwort = v.value;
    if (antwort == null || antwort === '') continue;
    antworten.push({
      frage_text: String(frage).trim(),
      antwort: typeof antwort === 'object' ? JSON.stringify(antwort) : String(antwort).trim(),
    });
  }

  // Falls auch keine question_* gefunden → vorhandene "normale" antworten (Nicht-Meta) übernehmen
  if (antworten.length === 0) {
    for (const a of rawAntworten) {
      const key = (a?.frage_text || '').toString().trim().toLowerCase();
      if (META_KEYS.has(key)) continue;
      if (a?.antwort == null || a.antwort === '') continue;
      antworten.push({ frage_text: a.frage_text, antwort: String(a.antwort) });
    }
  }

  return {
    name: name ? String(name).trim() || null : null,
    email: email ? String(email).trim() || null : null,
    telefon: telefon ? String(telefon).trim() || null : null,
    antworten,
  };
}
