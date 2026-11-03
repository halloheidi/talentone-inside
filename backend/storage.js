// Helpers für Supabase Storage (Upload, Delete, URL-Parsing).
// Backend uploaded mit Service Role Key → bypasst RLS.

/** Legt einen Bucket an, falls er noch nicht existiert — und hält (wenn angegeben)
 *  Größen-Limit und erlaubte MIME-Typen aktuell. Idempotent; die Limits sind damit
 *  im Code versioniert und werden beim Deploy angewendet (kein manueller DB-Eingriff). */
export async function ensureBucket(name, { isPublic = false, fileSizeLimit = null, allowedMimeTypes = null } = {}) {
  const auth = { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` };
  const spec = {};
  if (fileSizeLimit != null) spec.file_size_limit = fileSizeLimit;
  if (allowedMimeTypes != null) spec.allowed_mime_types = allowedMimeTypes;

  const list = await fetch(`${process.env.SUPABASE_URL}/storage/v1/bucket`, { headers: auth });
  let exists = false;
  if (list.ok) {
    const existing = await list.json();
    exists = Array.isArray(existing) && existing.some(b => b.name === name || b.id === name);
  }
  if (exists) {
    // Bucket vorhanden — nur wenn Limits/MIME vorgegeben sind, per PUT aktualisieren.
    if (Object.keys(spec).length) {
      const upd = await fetch(`${process.env.SUPABASE_URL}/storage/v1/bucket/${name}`, {
        method: 'PUT',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ public: !!isPublic, ...spec }),
      });
      if (!upd.ok) {
        const body = await upd.text().catch(() => '');
        console.warn(`[Storage] Bucket-Update ${name} ${upd.status}: ${body.slice(0, 200)}`);
      }
    }
    return;
  }
  const create = await fetch(`${process.env.SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: name, name, public: !!isPublic, ...spec }),
  });
  if (!create.ok) {
    const body = await create.text();
    if (!body.includes('already exists')) {
      console.warn(`[Storage] Bucket-Create ${name} ${create.status}: ${body.slice(0, 200)}`);
    }
  }
}

/** Lädt eine Datei aus einem privaten Bucket als Buffer. */
export async function downloadFromBucket({ bucket, path }) {
  const res = await fetch(
    `${process.env.SUPABASE_URL}/storage/v1/object/${bucket}/${path}`,
    { headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Storage ${res.status}: ${body.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function uploadBuffer({ bucket, path, buffer, contentType, upsert = true }) {
  const url = `${process.env.SUPABASE_URL}/storage/v1/object/${bucket}/${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': contentType,
      'x-upsert': upsert ? 'true' : 'false',
    },
    body: buffer,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Storage ${res.status}: ${body.slice(0, 300)}`);
  }
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}

/** Erzeugt eine zeitlich begrenzte Signed URL für ein Objekt in einem PRIVATEN
 *  Bucket. Für die Auslieferung von Bewerber-Anhängen an UI/Portal. */
export async function createSignedUrl({ bucket, path, expiresIn = 3600 }) {
  const res = await fetch(
    `${process.env.SUPABASE_URL}/storage/v1/object/sign/${bucket}/${path}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Storage sign ${res.status}: ${body.slice(0, 200)}`);
  }
  const j = await res.json();
  // Supabase liefert signedURL relativ (…/object/sign/bucket/path?token=…).
  return j?.signedURL ? `${process.env.SUPABASE_URL}/storage/v1${j.signedURL}` : null;
}

/** Erzeugt eine signierte Upload-URL, mit der der Browser eine Datei DIREKT in den
 *  Bucket lädt (ohne Umweg über den Backend-Container). Für große Video-Reels.
 *  Rückgabe: { signedUrl (PUT-Ziel), token, path, publicUrl }. */
export async function createSignedUploadUrl({ bucket, path }) {
  const res = await fetch(
    `${process.env.SUPABASE_URL}/storage/v1/object/upload/sign/${bucket}/${path}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Storage upload-sign ${res.status}: ${body.slice(0, 200)}`);
  }
  const j = await res.json();
  // Supabase liefert { url: '/object/upload/sign/bucket/path?token=…' } (relativ).
  const rel = j?.url || '';
  const token = (rel.split('token=')[1] || '').split('&')[0] || null;
  return {
    signedUrl: rel ? `${process.env.SUPABASE_URL}/storage/v1${rel}` : null,
    token,
    path,
    publicUrl: `${process.env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`,
  };
}

export async function deleteFromBucket(bucket, publicUrlOrPath) {
  if (!publicUrlOrPath) return;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = publicUrlOrPath.indexOf(marker);
  const path = idx >= 0 ? publicUrlOrPath.slice(idx + marker.length) : publicUrlOrPath;
  const res = await fetch(
    `${process.env.SUPABASE_URL}/storage/v1/object/${bucket}/${path}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
    },
  );
  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    console.warn(`[Storage] Delete fehlgeschlagen ${res.status}: ${body.slice(0, 200)}`);
  }
}

// Lädt eine öffentliche URL als Buffer + erkennt Content-Type. Für Image-Refs an OpenAI.
export async function fetchAsBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Image-Fetch ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  const contentType = res.headers.get('content-type') || 'image/png';
  return { buffer: Buffer.from(arrayBuffer), contentType };
}

const EXT_FROM_MIME = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg',
  'image/svg+xml': 'svg', 'image/webp': 'webp', 'video/mp4': 'mp4',
};

export function extFromMime(mime, fallback = 'png') {
  return EXT_FROM_MIME[mime] || fallback;
}

export function safeFilenameStem(name = '') {
  return String(name).replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40) || 'file';
}
