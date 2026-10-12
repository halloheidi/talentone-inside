// Reel-Ableitung (Creative-Wizard V2, Etappe 2): aus einem fertigen Creative ein
// 10s-Story-Video (9:16) via ffmpeg Ken-Burns — Zoom ~1.0→1.24 auf den Personen-/
// Mittenbereich. MP4 H.264 CRF 19, 30 fps. Rein serverseitig (lokal), keine KI.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fetchAsBuffer, uploadBuffer } from './storage.js';
import { STORAGE_BUCKET } from './imagegen.js';

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args);
    let stderr = '';
    p.stderr.on('data', d => { stderr += d.toString(); });
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${stderr.slice(-500)}`)));
  });
}

/**
 * Baut aus einem Creative-Bild ein 9:16-Ken-Burns-Reel (10s) und lädt es hoch.
 * @returns {Promise<{ url: string }>}
 */
export async function generateReelFromCreative({ bildUrl, jobId }) {
  if (!bildUrl) throw new Error('Kein Bild für das Reel.');
  const dir = await mkdtemp(path.join(tmpdir(), 'reel-'));
  const inFile = path.join(dir, 'in.png');
  const outFile = path.join(dir, 'out.mp4');
  try {
    const { buffer } = await fetchAsBuffer(bildUrl);
    await writeFile(inFile, buffer);

    // Upsampling vor zoompan (×2) für ruhigen Zoom; 300 Frames = 10s @ 30fps,
    // Zoom bis 1.24, Mitte horizontal, leicht unterhalb der Mitte (Personenbereich).
    const vf = [
      'scale=2160:3840:force_original_aspect_ratio=increase',
      'crop=2160:3840',
      "zoompan=z='min(zoom+0.0008,1.24)':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)*0.55':d=300:s=1080x1920:fps=30",
    ].join(',');

    await runFfmpeg([
      '-y', '-loop', '1', '-i', inFile, '-t', '10', '-r', '30',
      '-vf', vf,
      '-c:v', 'libx264', '-crf', '19', '-preset', 'medium', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', outFile,
    ]);

    const mp4 = await readFile(outFile);
    const key = `reels/${jobId}/${randomUUID()}.mp4`;
    const url = await uploadBuffer({ bucket: STORAGE_BUCKET, path: key, buffer: mp4, contentType: 'video/mp4' });
    return { url };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
