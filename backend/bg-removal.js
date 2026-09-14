// Serverseitige Hintergrund-Entfernung (Personen-Freisteller) für die
// deterministischen Layout-Vorlagen. Primär über die remove.bg-API (echtes
// Matting — die Person bleibt pixelgleich, keine KI-Neuerfindung). Ohne
// API-Key liefert das Modul { ok:false, reason:'no_key' } und die Vorlage
// fällt sauber auf das abgedunkelte Vollbild-Layout zurück.
//
// Ergebnisse werden pro Referenzbild in talentone_freisteller gecacht, damit
// nicht bei jeder Vorschau erneut ein (kostenpflichtiger) Call ausgelöst wird.

import { supabase } from './supabase.js';
import { uploadBuffer, fetchAsBuffer } from './storage.js';
import { STORAGE_BUCKET } from './imagegen.js';

const REMOVE_BG_API = 'https://api.remove.bg/v1.0/removebg';

export function freistellerVerfuegbar() {
  return !!process.env.REMOVE_BG_API_KEY;
}

// Rohe Hintergrund-Entfernung eines Buffers. Gibt { ok, buffer } oder { ok:false, reason }.
export async function removePersonBackground(imageBuffer) {
  const key = process.env.REMOVE_BG_API_KEY;
  if (!key) return { ok: false, reason: 'no_key' };
  try {
    const form = new FormData();
    form.append('image_file', new Blob([imageBuffer]), 'foto.png');
    form.append('size', 'auto');
    form.append('type', 'person');
    form.append('format', 'png');
    const resp = await fetch(REMOVE_BG_API, {
      method: 'POST',
      headers: { 'X-Api-Key': key },
      body: form,
    });
    if (!resp.ok) {
      const body = await resp.text();
      return { ok: false, reason: `remove.bg ${resp.status}: ${body.slice(0, 180)}` };
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    return { ok: true, buffer: buf };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * Get-or-create: liefert den Freisteller (transparentes PNG) für ein
 * Referenzbild — aus dem Cache, sonst frisch erzeugt und gecacht.
 *
 * @returns {Promise<{ ok:boolean, cutoutUrl?:string, buffer?:Buffer, reason?:string }>}
 */
export async function getOrCreateFreisteller(referenzbild) {
  const refId = referenzbild?.id;
  const bildUrl = referenzbild?.bild_url;
  if (!refId || !bildUrl) return { ok: false, reason: 'kein Referenzbild' };

  // Cache-Treffer?
  const { data: cached } = await supabase.from('talentone_freisteller')
    .select('*').eq('referenzbild_id', refId).maybeSingle();
  if (cached) {
    if (cached.ok && cached.cutout_url) {
      try {
        const { buffer } = await fetchAsBuffer(cached.cutout_url);
        return { ok: true, cutoutUrl: cached.cutout_url, buffer };
      } catch { /* Cache-URL kaputt → neu erzeugen */ }
    } else if (!cached.ok && cached.reason === 'no_key' && !freistellerVerfuegbar()) {
      return { ok: false, reason: 'no_key' };
    }
    // andere Fehlgründe: erneut versuchen (Key könnte inzwischen gesetzt sein)
  }

  const { buffer: original } = await fetchAsBuffer(bildUrl);
  const res = await removePersonBackground(original);

  if (!res.ok) {
    await supabase.from('talentone_freisteller')
      .upsert({ referenzbild_id: refId, ok: false, reason: res.reason, cutout_url: null });
    return { ok: false, reason: res.reason };
  }

  const path = `freisteller/${referenzbild.kunde_id || 'k'}/${refId}.png`;
  const cutoutUrl = await uploadBuffer({
    bucket: STORAGE_BUCKET, path, buffer: res.buffer, contentType: 'image/png',
  });
  await supabase.from('talentone_freisteller')
    .upsert({ referenzbild_id: refId, ok: true, cutout_url: cutoutUrl, reason: null });
  return { ok: true, cutoutUrl, buffer: res.buffer };
}
