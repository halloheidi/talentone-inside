import { supabase } from './supabase.js';

const BASE = import.meta.env.VITE_API_BASE || '/api';

async function authHeader() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
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
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}
