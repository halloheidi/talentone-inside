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
 */
export async function attachSignedAnhaenge(bewerbungen, opts = {}) {
  const list = Array.isArray(bewerbungen) ? bewerbungen : [];
  return Promise.all(list.map(async (b) => {
    const arr = Array.isArray(b?.anhaenge) ? b.anhaenge : [];
    if (!arr.length) return { ...b, anhaenge: [] };
    return { ...b, anhaenge: await anhaengeMitSignedUrls(arr, opts) };
  }));
}
