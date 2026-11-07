// Higgsfield Seedance 2.5 — Reference-to-Video (Bild → kurzes Video).
// Auth: Authorization: Key <HIGGSFIELD_API_KEY>, wobei HIGGSFIELD_API_KEY der
// komplette Schlüssel im Format "KEY_ID:KEY_SECRET" ist (einmalig in der Console
// angezeigt). Submit → Poll (status_url) bis completed/failed/nsfw.
//
// Blaupause: kling.js (gleiches Submit/Poll/Download/Upload-Muster).

import { uploadBuffer } from './storage.js';

const BASE_URL = process.env.HIGGSFIELD_BASE_URL || 'https://api.higgsfield.ai';
const ENDPOINT = '/bytedance/seedance-2.5/reference-to-video';
const BUCKET = 'talentone-creatives';

function authHeader() {
  const key = process.env.HIGGSFIELD_API_KEY;
  if (!key) throw new Error('HIGGSFIELD_API_KEY nicht gesetzt (Format "KEY_ID:KEY_SECRET").');
  return `Key ${key}`;
}

// Interne Format-Keys → von Seedance unterstütztes aspect_ratio.
// Hinweis: 4:5 (feed) wird NICHT unterstützt → 3:4 (am nächsten, hochkant); der
// ffmpeg-Overlay-Schritt skaliert/beschneidet danach minimal auf 1080×1350.
export function aspectForFormat(format) {
  if (format === 'story') return '9:16';
  if (format === 'feed') return '3:4';
  return '1:1'; // quadrat
}

async function hfFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader(),
      ...(opts.headers || {}),
    },
  });
  const body = await res.text();
  let parsed;
  try { parsed = JSON.parse(body); } catch { parsed = { raw: body }; }
  if (!res.ok) {
    throw new Error(`Higgsfield ${res.status}: ${parsed.error || parsed.message || body.slice(0, 300)}`);
  }
  return parsed;
}

// Startet einen Reference-to-Video-Job. Returns { requestId, statusUrl }.
async function submitReferenceToVideo({ imageUrl, prompt, durationSec = 6, resolution = '720p', aspectRatio = '9:16' }) {
  if (!imageUrl) throw new Error('imageUrl fehlt.');
  const payload = {
    image_urls: [imageUrl],
    prompt,
    duration: Math.max(4, Math.min(30, Math.round(durationSec))),
    resolution,
    aspect_ratio: aspectRatio,
    generate_audio: false,   // kein Ton (Regel)
  };
  const res = await hfFetch(`${BASE_URL}${ENDPOINT}`, { method: 'POST', body: JSON.stringify(payload) });
  const requestId = res.request_id || res.id;
  const statusUrl = res.status_url || (requestId ? `${BASE_URL}/requests/${requestId}/status` : null);
  if (!statusUrl) throw new Error('Higgsfield: keine status_url/request_id in Submit-Response.');
  return { requestId, statusUrl };
}

// Pollt bis completed (Video-URL) oder failed/nsfw/canceled/Timeout.
async function pollRequest(statusUrl, { timeoutMs = 8 * 60 * 1000, intervalMs = 6000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const data = await hfFetch(statusUrl);
    const status = data.status;
    if (status === 'completed') {
      const url = data.video?.url || data.result?.video?.url || data.results?.[0]?.raw?.url;
      if (!url) throw new Error('Higgsfield: completed, aber keine Video-URL.');
      // Credits best effort aus diversen möglichen Feldern.
      const credits = data.credits ?? data.cost ?? data.usage?.credits ?? null;
      return { url, credits };
    }
    if (status === 'failed') throw new Error(`Higgsfield fehlgeschlagen: ${data.error || 'unbekannt'}`);
    if (status === 'nsfw') throw new Error('Higgsfield: Inhalt von der Moderation abgelehnt (nsfw).');
    if (status === 'canceled') throw new Error('Higgsfield: Request abgebrochen.');
    // queued / in_progress → weiter pollen
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Higgsfield Polling-Timeout nach ${Math.round(timeoutMs / 1000)}s.`);
}

export function higgsfieldKonfiguriert() {
  return !!process.env.HIGGSFIELD_API_KEY;
}

// Komplett-Flow: Submit + Poll + Download + Upload in den Creatives-Bucket.
// @returns {Promise<{ url, requestId, remoteUrl, credits }>}
export async function generateVideoFromImage({ imageUrl, prompt, jobId, format = 'story', durationSec = 6, resolution = '720p' }) {
  const aspectRatio = aspectForFormat(format);
  console.log(`[higgsfield] Submit (${aspectRatio}, ${durationSec}s) für ${imageUrl.slice(-40)}`);
  const { requestId, statusUrl } = await submitReferenceToVideo({ imageUrl, prompt, durationSec, resolution, aspectRatio });
  console.log(`[higgsfield] request ${requestId} läuft, polling…`);
  const { url: remoteUrl, credits } = await pollRequest(statusUrl);
  console.log(`[higgsfield] Video fertig: ${String(remoteUrl).slice(-60)}`);

  const dl = await fetch(remoteUrl);
  if (!dl.ok) throw new Error(`Video-Download fehlgeschlagen ${dl.status}`);
  const buffer = Buffer.from(await dl.arrayBuffer());
  const path = `reels/${jobId}/hf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.mp4`;
  const url = await uploadBuffer({ bucket: BUCKET, path, buffer, contentType: 'video/mp4' });
  return { url, requestId, remoteUrl, credits };
}
