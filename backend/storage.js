// Helpers für Supabase Storage (Upload, Delete, URL-Parsing).
// Backend uploaded mit Service Role Key → bypasst RLS.

/** Legt einen (privaten) Bucket an, falls er noch nicht existiert. Idempotent. */
export async function ensureBucket(name, { isPublic = false } = {}) {
  const list = await fetch(`${process.env.SUPABASE_URL}/storage/v1/bucket`, {
    headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  if (list.ok) {
    const existing = await list.json();
    if (Array.isArray(existing) && existing.some(b => b.name === name || b.id === name)) return;
  }
  const create = await fetch(`${process.env.SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id: name, name, public: !!isPublic }),
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
