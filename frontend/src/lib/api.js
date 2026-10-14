import { supabase } from './supabase.js';

const BASE = import.meta.env.VITE_API_BASE || '/api';

async function authHeader() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Öffnet einen Bewerber-Anhang über den stabilen Download-Endpoint. Intern ist
 * der Endpoint login-geschützt → wir holen per authentifiziertem Fetch eine
 * frische (kurzlebige) Signed URL und öffnen sie. `path` ist der vom Backend
 * gelieferte Endpoint-Pfad, z. B. /api/anhaenge/<id>/<index>.
 */
export async function openAnhang(path) {
  try {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${path}${sep}format=json`, { headers: { ...(await authHeader()) } });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Anhang konnte nicht geöffnet werden.');
      return;
    }
    const { url } = await res.json();
    if (url) window.open(url, '_blank', 'noopener');
  } catch {
    alert('Anhang konnte nicht geöffnet werden.');
  }
}

/**
 * Lädt eine auth-geschützte Datei (z. B. Gmail-Anhang-Proxy) per Bearer-Token,
 * als Blob, und stößt den Download an — ein normaler <a href> trägt den JWT nicht.
 */
export async function downloadAuthed(path, filename = 'download') {
  try {
    const res = await fetch(`${BASE}${path}`, { headers: { ...(await authHeader()) } });
    if (!res.ok) { alert('Download fehlgeschlagen.'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch { alert('Download fehlgeschlagen.'); }
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeader()),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    // Bei abgelaufener Session: sauber ausloggen + Login-Prompt statt stummer Save-Fehler.
    if (res.status === 401) {
      try { await supabase.auth.signOut(); } catch {}
      const msg = 'Deine Session ist abgelaufen. Bitte melde dich neu an.';
      if (typeof window !== 'undefined') {
        alert(msg);
        window.location.href = '/login';
      }
      throw new Error(msg);
    }
    const e = new Error(err.error || `HTTP ${res.status}`);
    e.status = res.status;
    e.body = err;
    throw e;
  }
  return res.json();
}
