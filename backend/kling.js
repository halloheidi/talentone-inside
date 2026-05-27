// Kling AI Video Generierung (Image-to-Video).
// JWT-Auth über access_key + secret_key (HS256), Polling bis Task fertig.

import jwt from 'jsonwebtoken';
import { uploadBuffer } from './storage.js';

const BASE_URL  = process.env.KLING_BASE_URL  || 'https://api-singapore.klingai.com';
const MODEL     = process.env.KLING_MODEL     || 'kling-v2-master';
const BUCKET    = 'talentone-creatives';

function createJwtToken() {
  const ak = process.env.KLING_ACCESS_KEY;
  const sk = process.env.KLING_SECRET_KEY;
  if (!ak || !sk) throw new Error('KLING_ACCESS_KEY / KLING_SECRET_KEY nicht gesetzt.');
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { iss: ak, exp: now + 1800, nbf: now - 5 },
    sk,
    { algorithm: 'HS256', header: { alg: 'HS256', typ: 'JWT' } },
  );
}

async function klingFetch(path, opts = {}) {
  const token = createJwtToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(opts.headers || {}),
    },
  });
  const body = await res.text();
  let parsed;
  try { parsed = JSON.parse(body); } catch { parsed = { raw: body }; }
  if (!res.ok) {
    throw new Error(`Kling ${res.status}: ${parsed.message || body.slice(0, 300)}`);
  }
  return parsed;
}

/* ───────────────── Image-to-Video ───────────────── */

// Startet einen Video-Task. Returns task_id.
async function submitImage2Video({ imageUrl, prompt, duration = '5', aspectRatio = '9:16' }) {
  const payload = {
    model_name: MODEL,
    image: imageUrl,
    prompt,
    duration: String(duration),
    aspect_ratio: aspectRatio,
  };
  const res = await klingFetch('/v1/videos/image2video', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (res.code !== 0) {
    throw new Error(`Kling Submit fehlgeschlagen: ${res.message || JSON.stringify(res)}`);
  }
  const taskId = res.data?.task_id;
  if (!taskId) throw new Error('Kling: kein task_id in Submit-Response.');
  return taskId;
}

// Pollt einen Video-Task bis fertig (succeed) oder failed/timeout.
async function pollVideoTask(taskId, { timeoutMs = 6 * 60 * 1000, intervalMs = 6000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await klingFetch(`/v1/videos/image2video/${taskId}`);
    if (res.code !== 0) {
      throw new Error(`Kling Polling fehlgeschlagen: ${res.message || JSON.stringify(res)}`);
    }
    const data = res.data || {};
    const status = data.task_status;
    if (status === 'succeed') {
      const url = data.task_result?.videos?.[0]?.url;
      if (!url) throw new Error('Kling: succeed aber keine Video-URL.');
      return url;
    }
    if (status === 'failed') {
      throw new Error(`Kling Task failed: ${data.task_status_msg || 'unknown'}`);
    }
    // submitted / processing → weiter pollen
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Kling Polling Timeout nach ${Math.round(timeoutMs / 1000)}s.`);
}

// Komplett-Flow: Submit + Poll + Download + Upload nach Storage.
export async function generateReelFromImage({ imageUrl, prompt, jobId }) {
  if (!imageUrl) throw new Error('imageUrl fehlt.');
  console.log(`[kling] Submit für ${imageUrl.slice(-40)}`);
  const taskId = await submitImage2Video({
    imageUrl,
    prompt,
    duration: '5',
    aspectRatio: '9:16',
  });
  console.log(`[kling] Task ${taskId} läuft, polling…`);
  const remoteUrl = await pollVideoTask(taskId);
  console.log(`[kling] Video fertig: ${remoteUrl.slice(-60)}`);

  // Video herunterladen und in Supabase Storage spiegeln
  const dl = await fetch(remoteUrl);
  if (!dl.ok) throw new Error(`Video-Download fehlgeschlagen ${dl.status}`);
  const buffer = Buffer.from(await dl.arrayBuffer());
  const path = `${jobId}/reel-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.mp4`;
  const url = await uploadBuffer({
    bucket: BUCKET, path, buffer, contentType: 'video/mp4',
  });
  return { url, taskId, remoteUrl };
}
