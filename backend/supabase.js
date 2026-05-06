import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.warn('[Supabase] SUPABASE_URL oder SUPABASE_SERVICE_ROLE_KEY fehlt — Backend startet ohne DB-Zugriff.');
}

export const supabase = url && key
  ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

export function requireSupabase(res) {
  if (!supabase) {
    res.status(500).json({ error: 'Supabase nicht konfiguriert.' });
    return false;
  }
  return true;
}
