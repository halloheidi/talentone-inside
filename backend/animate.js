// „Animierte Variante": aus einem freigegebenen Referenzfoto ein kurzes Video
// (Higgsfield Seedance 2.5, nur Ambient-Bewegung) + deterministisches Text-Overlay
// (Layout-Vorlage A/B, CI-Regeln von creative-ci.js) per ffmpeg. Läuft im Hintergrund.
//
// Datenmodell: eine talentone_creatives-Zeile (typ='video', quelle='higgsfield_video').
//   status 'processing' → 'fertig' (bild_url = Overlay-mp4) oder 'fehler' (+ fehler-Text).

import { supabase } from './supabase.js';
import { generateVideoFromImage } from './higgsfield.js';
import { overlayTextOnVideo } from './reel-ffmpeg.js';
import { renderLayoutLayerBuffer } from './layout-vorlagen.js';

// Fixes Prompt-Template: nur Ambient-Bewegung, alles Konkrete bleibt unverändert.
export function buildAnimatePrompt(format) {
  const base = 'Subtle ambient motion only: drifting clouds, shifting sunlight, gentle water ripples, '
    + 'softly rustling leaves and subtle light reflections. Keep every person, vehicle, logo and any text '
    + 'completely static and unchanged — do not alter faces, bodies, clothing or vehicles, and add nothing new. '
    + 'Very slow, gentle push-in camera. Photorealistic; preserve the original photo’s exposure, sky and colors.';
  if (format === 'story') {
    return base + ' Naturally extend the scene to fill a vertical 9:16 frame (outpaint above and below) '
      + 'without cropping or changing the main subject.';
  }
  return base;
}

// Baut die zwei Overlay-Ebenen: statisch (Stellentitel/Pill/Logo, Headline leer) und
// Headline-only (für den 0,5-s-Einblend-Effekt). Beide transparent, im Zielformat.
async function renderOverlays({ vorlage, kunde, logoUri, slots, format }) {
  const headlineKey = vorlage === 'B' ? 'textblock' : 'hook';
  const staticSlots = { ...slots, [headlineKey]: '' };
  const staticOverlay = await renderLayoutLayerBuffer({
    vorlage, kunde, fotoUri: '', cutoutUri: null, logoUri, slots: staticSlots, format, layer: 'overlay',
  });

  let hookOverlay = null;
  if (String(slots?.[headlineKey] || '').trim()) {
    const hookSlots = { [headlineKey]: slots[headlineKey] };
    hookOverlay = await renderLayoutLayerBuffer({
      vorlage, kunde, fotoUri: '', cutoutUri: null, logoUri: null, slots: hookSlots, format, layer: 'overlay',
    });
  }
  return { staticOverlay, hookOverlay };
}

async function logKosten({ job, format, credits }) {
  if (!job?.projekt_id) return;
  const creditTxt = credits != null ? `${credits} Credits` : 'Credits unbekannt';
  const fmtTxt = { quadrat: '1:1', feed: '4:5', story: '9:16' }[format] || format;
  try {
    await supabase.from('talentone_kommentare').insert({
      projekt_id: job.projekt_id,
      autor: 'System',
      text: `🎬 Animierter Clip (${fmtTxt}) via Higgsfield erstellt — ${creditTxt}.`,
      quelle: 'system',
    });
  } catch (err) { console.warn('[animate] Kosten-Log fehlgeschlagen:', err.message); }
}

/**
 * Hintergrund-Pipeline. Aktualisiert die bestehende Creative-Zeile (creativeId).
 * @param {{ creativeId, job, kunde, refBildUrl, logoUri, vorlage, format, slots, rohVideoUrl? }} p
 */
export async function erzeugeAnimiertesCreative({ creativeId, job, kunde, refBildUrl, logoUri, vorlage, format, slots, rohVideoUrl = null }) {
  const patch = async (fields) => {
    const { error } = await supabase.from('talentone_creatives').update(fields).eq('id', creativeId);
    if (error) console.error('[animate] DB-Update:', error.message);
  };
  try {
    // 1. Rohvideo (Higgsfield) — bei Retry mit vorhandenem Roh-Clip überspringen.
    let credits = null;
    if (!rohVideoUrl) {
      const prompt = buildAnimatePrompt(format);
      const gen = await generateVideoFromImage({ imageUrl: refBildUrl, prompt, jobId: job.id, format, durationSec: 6, resolution: '720p' });
      rohVideoUrl = gen.url;
      credits = gen.credits ?? null;
      await patch({ roh_video_url: rohVideoUrl, higgsfield_request_id: gen.requestId || null, kosten_credits: credits });
    }

    // 2. Text-Overlay-Ebenen rendern (gleiche CI-/Layout-Regeln wie die Bild-Creatives).
    const { staticOverlay, hookOverlay } = await renderOverlays({ vorlage, kunde, logoUri, slots, format });

    // 3. Overlay per ffmpeg aufs Video legen (+ Poster-Frame für Mail/Portal).
    const { url, posterUrl } = await overlayTextOnVideo({ videoUrl: rohVideoUrl, staticOverlay, hookOverlay, format, jobId: job.id });

    // 4. Fertig. Poster liegt in bild_ohne_logo_url (bei Videos sonst ungenutzt).
    await patch({ bild_url: url, bild_ohne_logo_url: posterUrl || null, status: 'fertig', fehler: null });
    await logKosten({ job, format, credits });
    console.log(`[animate] fertig für creative ${String(creativeId).slice(0, 8)}`);
  } catch (err) {
    console.error('[animate]', err.message);
    await patch({ status: 'fehler', fehler: String(err.message || err).slice(0, 500) });
  }
}
