// Bewerber-Datei-Anhänge: Erkennung im Roh-Payload, Spiegelung in einen privaten
// Supabase-Bucket und Auslieferung via Signed URLs.
//
// Interne Speicher-Form (Spalte talentone_bewerbungen.anhaenge):
//   [{ label, dateiname, url_original, storage_path }]
//   - url_original: externe URL (Onepage-Storage o. Ä.) — Fallback, kann sterben.
//   - storage_path: Pfad im Bucket talentone-bewerber-anhaenge ({bewerbung_id}/{name}),
//                   null wenn Spiegeln fehlschlug.
// Auslieferung an UI/Portal/Mail: anhaengeMitSignedUrls() → [{ label, dateiname, url }].

import { ensureBucket, uploadBuffer, createSignedUrl, fetchAsBuffer } from './storage.js';

export const ANHAENGE_BUCKET = 'talentone-bewerber-anhaenge';

// Datei-Endungen, die wir als Anhang erkennen (Lebenslauf, Zeugnisse, Fotos …).
const FILE_EXT_RE = /\.(pdf|docx?|odt|rtf|txt|jpe?g|png|webp|heic|gif|tiff?)(?:$|[?#])/i;

function isFileUrl(v) {
  return typeof v === 'string' && /^https?:\/\//i.test(v) && FILE_EXT_RE.test(v);
}

function basenameFromUrl(url) {
  try {
    const clean = String(url).split('?')[0].split('#')[0];
    const seg = decodeURIComponent(clean.split('/').filter(Boolean).pop() || '');
    return seg || 'anhang';
  } catch { return 'anhang'; }
}

// Dateiname für den Bucket-Pfad sicher machen (behält die Endung).
function safeStorageName(dateiname, url, index) {
  const raw = String(dateiname || basenameFromUrl(url) || 'anhang');
  let stem = raw.replace(/\.[^.]+$/, '');
  let ext = (raw.match(/\.([^.]+)$/)?.[1] || basenameFromUrl(url).match(/\.([^.]+)$/)?.[1] || 'bin').toLowerCase();
  stem = stem.normalize('NFKD').replace(/[^\w-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'anhang';
  ext = ext.replace(/[^a-z0-9]+/g, '').slice(0, 8) || 'bin';
  return `${index}-${stem}.${ext}`;
}

/**
 * Erkennt Datei-Anhänge in einem Roh-Payload (Onepage data.fields[], Perspective
 * profile/values, flaches JSON). Gibt [{label, dateiname, url_original, storage_path:null}]
 * zurück — noch ohne Spiegelung. Robust gegen unbekannte Upload-Shapes.
 */
export function extractAnhaenge(body) {
  if (!body || typeof body !== 'object') return [];
  const out = [];
  const seen = new Set();

  const add = (url, name, label) => {
    if (!url || typeof url !== 'string') return;
    const u = url.trim();
    if (!/^https?:\/\//i.test(u) || seen.has(u)) return;
    seen.add(u);
    out.push({
      label: String(label || 'Datei').trim() || 'Datei',
      dateiname: String(name || basenameFromUrl(u)).trim() || basenameFromUrl(u),
      url_original: u,
      storage_path: null,
    });
  };

  // forceFile=true (bekanntes Upload-Feld): jede http-URL zählt, auch ohne Endung.
  const walk = (val, label, forceFile) => {
    if (val == null) return;
    if (typeof val === 'string') {
      if (forceFile ? /^https?:\/\//i.test(val) : isFileUrl(val)) add(val, null, label);
      return;
    }
    if (Array.isArray(val)) { for (const it of val) walk(it, label, forceFile); return; }
    if (typeof val === 'object') {
      const url = val.url || val.href || val.link || val.downloadUrl || val.download_url
        || val.src || val.file || val.fileUrl || val.location || val.publicUrl || val.signedUrl;
      const name = val.name || val.filename || val.fileName || val.originalName
        || val.original_name || val.title;
      if (url && (forceFile || isFileUrl(String(url)))) { add(String(url), name, label); return; }
      for (const v of Object.values(val)) walk(v, label, forceFile);
    }
  };

  // 1) Onepage: data.fields[] — Upload-Felder scharf, andere Felder nur echte Datei-URLs.
  const fields = body?.data?.fields;
  if (Array.isArray(fields)) {
    for (const f of fields) {
      const ftype = String(f?.fieldType || '').toLowerCase();
      const label = String(f?.step || f?.label || 'Datei').trim() || 'Datei';
      const istUpload = /uploader|upload|file|attach/.test(ftype);
      walk(f?.value, istUpload ? (label === 'Datei' ? (f?.step || f?.label || 'Datei') : label) : label, istUpload);
    }
  }

  // 2) Perspective-Profil: { key: {title, value} } oder direkte Werte.
  if (body?.profile && typeof body.profile === 'object') {
    for (const [k, v] of Object.entries(body.profile)) {
      const label = (v && typeof v === 'object' && (v.title || v.label)) ? (v.title || v.label) : k;
      const value = (v && typeof v === 'object' && 'value' in v) ? v.value : v;
      walk(value, label, false);
    }
  }

  // 3) values + flache Top-Level-Felder (ohne die schon behandelten Container).
  if (body?.values && typeof body.values === 'object') {
    for (const [k, v] of Object.entries(body.values)) walk(v, k, false);
  }
  for (const [k, v] of Object.entries(body)) {
    if (k === 'data' || k === 'profile' || k === 'values' || k === '_raw') continue;
    walk(v, k, false);
  }

  // 4) Verschachtelter Roh-Payload (z. B. b._raw bei manchen Webhooks).
  if (body?._raw && typeof body._raw === 'object' && body._raw !== body) {
    for (const it of extractAnhaenge(body._raw)) {
      if (!seen.has(it.url_original)) { seen.add(it.url_original); out.push(it); }
    }
  }

  return out;
}

/**
 * Spiegelt die Original-URLs in den privaten Bucket. Non-fatal je Datei —
 * schlägt der Download fehl, bleibt storage_path null (nur Original-Link).
 * Gibt { anhaenge (aktualisiert), gespiegelt, tot } zurück.
 */
export async function spiegeleAnhaenge(bewerbungId, anhaenge) {
  const arr = Array.isArray(anhaenge) ? anhaenge : [];
  if (!arr.length) return { anhaenge: arr, gespiegelt: 0, tot: 0 };

  try { await ensureBucket(ANHAENGE_BUCKET, { isPublic: false }); }
  catch (e) { console.warn('[anhaenge] ensureBucket:', e.message); }

  let gespiegelt = 0, tot = 0;
  const out = [];
  let i = 0;
  for (const a of arr) {
    i++;
    if (a?.storage_path) { out.push(a); gespiegelt++; continue; } // schon gespiegelt
    if (!a?.url_original) { out.push(a); continue; }
    const path = `${bewerbungId}/${safeStorageName(a.dateiname, a.url_original, i)}`;
    try {
      const { buffer, contentType } = await fetchAsBuffer(a.url_original);
      await uploadBuffer({ bucket: ANHAENGE_BUCKET, path, buffer, contentType: contentType || 'application/octet-stream' });
      out.push({ ...a, storage_path: path });
      gespiegelt++;
    } catch (e) {
      console.warn(`[anhaenge] Spiegeln fehlgeschlagen (${a.url_original}): ${e.message}`);
      out.push({ ...a, storage_path: null });
      tot++;
    }
  }
  return { anhaenge: out, gespiegelt, tot };
}

/**
 * Löst die interne Speicher-Form in auslieferbare Links auf: bevorzugt eine
 * frische Signed URL aus dem privaten Bucket, sonst die Original-URL.
 * → [{ label, dateiname, url }]
 */
export async function anhaengeMitSignedUrls(anhaenge, { expiresIn = 3600 } = {}) {
  const arr = Array.isArray(anhaenge) ? anhaenge : [];
  const out = [];
  for (const a of arr) {
    let url = a?.url_original || null;
    if (a?.storage_path) {
      try {
        const signed = await createSignedUrl({ bucket: ANHAENGE_BUCKET, path: a.storage_path, expiresIn });
        if (signed) url = signed;
      } catch (e) { /* Fallback: Original-URL */ }
    }
    if (!url) continue;
    out.push({ label: a?.label || 'Datei', dateiname: a?.dateiname || basenameFromUrl(url), url });
  }
  return out;
}

/**
 * Reichert eine Liste geladener Bewerbungen an: ersetzt `anhaenge` (interne Form)
 * durch die auslieferbare Signed-URL-Form. Bewerbungen ohne Anhänge lösen keine
 * Storage-Calls aus.
 *
 * @deprecated Signierte URLs mit Ablauf werden nicht mehr in Ansichten/Mails
 * eingebettet (verwaiste Links nach Ablauf). Stattdessen `attachStableAnhaenge`
 * (stabiler Klick-Endpoint `/api/anhaenge/:id/:index`). Bleibt nur als Fallback.
 */
export async function attachSignedAnhaenge(bewerbungen, opts = {}) {
  const list = Array.isArray(bewerbungen) ? bewerbungen : [];
  return Promise.all(list.map(async (b) => {
    const arr = Array.isArray(b?.anhaenge) ? b.anhaenge : [];
    if (!arr.length) return { ...b, anhaenge: [] };
    return { ...b, anhaenge: await anhaengeMitSignedUrls(arr, opts) };
  }));
}

/* ─────────────────── Stabiler Download-Endpoint ─────────────────── */

/**
 * Baut einen STABILEN Anhang-Link, der NIE abläuft: zeigt auf den Download-
 * Endpoint, der erst beim Klick eine frische Signed URL erzeugt.
 *   intern  → /api/anhaenge/:id/:index          (Auth per Login-Session)
 *   Portal  → /api/anhaenge/:id/:index?token=…   (Auth per Portal-Token)
 * `base` (absolut, z. B. https://inside.talent-one.de) nur für Mails nötig;
 * in-App genügt der wurzel-relative Pfad.
 */
export function buildStableAnhangUrl({ bewerbungId, index, token = null, base = '' }) {
  const q = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${base}/api/anhaenge/${encodeURIComponent(bewerbungId)}/${index}${q}`;
}

/**
 * Auslieferungsform mit STABILEN Links statt Signed URLs. Behält den Index in
 * der gespeicherten `anhaenge`-Reihenfolge bei (der Endpoint adressiert per Index).
 * `auth: true` (intern, ohne Token) signalisiert dem Frontend, dass der Link per
 * authentifiziertem Fetch (Login-Session) geöffnet werden muss, nicht als Direkt-
 * Navigation. Bei Portal-Token entfällt das (Token steckt im Link).
 * → [{ label, dateiname, url, auth? }]
 */
export function stableAnhaengeForBewerbung(anhaenge, { bewerbungId, token = null, base = '' }) {
  const arr = Array.isArray(anhaenge) ? anhaenge : [];
  const out = [];
  arr.forEach((a, index) => {
    if (!a) return;
    if (!a.storage_path && !a.url_original) return; // nichts auslieferbar
    const entry = {
      label: a.label || 'Datei',
      dateiname: a.dateiname || 'Datei',
      url: buildStableAnhangUrl({ bewerbungId, index, token, base }),
    };
    if (!token) entry.auth = true;
    out.push(entry);
  });
  return out;
}

/**
 * Wie `attachSignedAnhaenge`, aber mit stabilen Endpoint-Links (kein Ablauf).
 * token=null → interne Ansicht (auth-Fetch); token gesetzt → Kundenportal.
 */
export function attachStableAnhaenge(bewerbungen, { token = null, base = '' } = {}) {
  const list = Array.isArray(bewerbungen) ? bewerbungen : [];
  return list.map((b) => {
    const arr = Array.isArray(b?.anhaenge) ? b.anhaenge : [];
    if (!arr.length) return { ...b, anhaenge: [] };
    return { ...b, anhaenge: stableAnhaengeForBewerbung(arr, { bewerbungId: b.id, token, base }) };
  });
}

/**
 * Löst EINEN Anhang beim Klick zu einer frischen, kurzlebigen Signed URL auf.
 * Fallback bei fehlender Spiegelung: storage_path leer, aber url_original da →
 * on demand laden, in den Bucket spiegeln, Pfad zurückgeben (Aufrufer trägt ihn
 * in der Zeile nach). Ist die Original-URL tot → { dead: true } (sauberer Hinweis
 * statt Fehlerseite). `backfilledPath` gesetzt → frisch gespiegelt, nachtragen.
 * @returns {Promise<{ url?: string, dateiname?: string, backfilledPath?: string, dead?: boolean }>}
 */
export async function resolveAnhangDownload({ bewerbungId, anhang, index, expiresIn = 300 }) {
  if (!anhang) return { dead: true };
  const dateiname = anhang.dateiname || basenameFromUrl(anhang.url_original || '') || 'anhang';

  // 1) Bereits gespiegelt → frische Signed URL.
  if (anhang.storage_path) {
    try {
      const url = await createSignedUrl({ bucket: ANHAENGE_BUCKET, path: anhang.storage_path, expiresIn });
      if (url) return { url, dateiname };
    } catch (e) { console.warn(`[anhaenge] sign fehlgeschlagen (${anhang.storage_path}): ${e.message}`); }
    // Signieren scheiterte, aber Pfad existiert → letzter Ausweg Original-URL.
    if (anhang.url_original) return { url: anhang.url_original, dateiname };
    return { dead: true };
  }

  // 2) Keine Spiegelung, aber Original-URL → on demand spiegeln + nachtragen.
  if (anhang.url_original) {
    try { await ensureBucket(ANHAENGE_BUCKET, { isPublic: false }); } catch {}
    const path = `${bewerbungId}/${safeStorageName(anhang.dateiname, anhang.url_original, index + 1)}`;
    try {
      const { buffer, contentType } = await fetchAsBuffer(anhang.url_original);
      await uploadBuffer({ bucket: ANHAENGE_BUCKET, path, buffer, contentType: contentType || 'application/octet-stream' });
      const url = await createSignedUrl({ bucket: ANHAENGE_BUCKET, path, expiresIn });
      return { url: url || anhang.url_original, dateiname, backfilledPath: path };
    } catch (e) {
      console.warn(`[anhaenge] on-demand-Spiegeln tot (${anhang.url_original}): ${e.message}`);
      return { dead: true };
    }
  }

  return { dead: true };
}
