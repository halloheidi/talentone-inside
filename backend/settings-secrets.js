// Runtime-editierbare Secrets in talentone_settings (DB-Wert bevorzugt, sonst
// process.env-Fallback) — verallgemeinert aus dem Meta-Token-Muster (meta-sync.js).
// So kann Johannes Keys (CLOSE_API_KEY, INSTANTLY_API_KEY) im Admin-UI eintragen,
// ohne die .env.local auf dem VPS anzufassen.

import { supabase } from './supabase.js';

// Registry: logischer Schlüssel in talentone_settings ↔ Env-Fallback-Variable.
export const SECRET_KEYS = {
  close_api_key:     { env: 'CLOSE_API_KEY',     label: 'Close CRM API-Key' },
  instantly_api_key: { env: 'INSTANTLY_API_KEY', label: 'Instantly API-Key' },
};

const _cache = new Map(); // schluessel → { wert, ts }
const TTL_MS = 60 * 1000; // 60s — neu eingetragene Keys greifen zügig, ohne DB-Last

/**
 * Liefert den Secret-Wert: DB (talentone_settings.wert) bevorzugt, sonst env.
 * Leerer/fehlender DB-Wert → Env-Fallback. Nie Fehler werfend (best effort).
 */
export async function getSecret(schluessel) {
  const envVar = SECRET_KEYS[schluessel]?.env;
  const cached = _cache.get(schluessel);
  if (cached && Date.now() - cached.ts < TTL_MS) {
    return cached.wert || (envVar ? process.env[envVar] : null) || null;
  }
  let dbWert = null;
  try {
    const { data } = await supabase.from('talentone_settings')
      .select('wert').eq('schluessel', schluessel).maybeSingle();
    dbWert = (data?.wert || '').trim() || null;
  } catch (e) { /* DB-Fehler → Env-Fallback */ }
  _cache.set(schluessel, { wert: dbWert, ts: Date.now() });
  return dbWert || (envVar ? process.env[envVar] : null) || null;
}

/** Setzt/aktualisiert einen Secret-Wert in der DB. */
export async function setSecret(schluessel, wert, updatedBy = null) {
  const { error } = await supabase.from('talentone_settings')
    .upsert({ schluessel, wert: (wert || '').trim(), updated_at: new Date().toISOString(), updated_by: updatedBy },
            { onConflict: 'schluessel' });
  if (error) throw new Error(error.message);
  _cache.delete(schluessel);
}

/** Entfernt den DB-Override (fällt danach wieder auf env zurück). */
export async function clearSecret(schluessel) {
  await supabase.from('talentone_settings').delete().eq('schluessel', schluessel);
  _cache.delete(schluessel);
}

/**
 * Maskierter Status für die Admin-UI — gibt NIE den Rohwert zurück.
 * @returns { gesetzt, quelle: 'settings'|'env'|null, hinweis }
 */
export async function secretStatus(schluessel) {
  const envVar = SECRET_KEYS[schluessel]?.env;
  let dbWert = null;
  try {
    const { data } = await supabase.from('talentone_settings')
      .select('wert').eq('schluessel', schluessel).maybeSingle();
    dbWert = (data?.wert || '').trim() || null;
  } catch { /* ignore */ }
  const envWert = envVar ? (process.env[envVar] || '').trim() || null : null;
  const wert = dbWert || envWert;
  if (!wert) return { gesetzt: false, quelle: null, hinweis: null };
  const last4 = wert.length > 4 ? wert.slice(-4) : '••';
  return { gesetzt: true, quelle: dbWert ? 'settings' : 'env', hinweis: `endet auf …${last4}` };
}
