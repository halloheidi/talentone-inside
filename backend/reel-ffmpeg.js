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
import { FORMAT_DIMS } from './text-bloecke.js';

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

/**
 * Zweistufiges Reel: (a) nur das Hintergrundfoto als 9:16-Ken-Burns-Ebene, (b) darüber
 * die statische, scharfe Overlay-Ebene (Hook/Titel/Badge/Logo, transparentes PNG, bereits
 * im 9:16-Layout gesetzt). So zoomt nur das Foto, der Text bleibt randscharf.
 * @param {{ bgUrl?:string, bgBuffer?:Buffer, overlayBuffer:Buffer, jobId:string }} p
 */
export async function generateReelLayered({ bgUrl, bgBuffer, overlayBuffer, jobId }) {
  if (!overlayBuffer) throw new Error('Keine Overlay-Ebene.');
  const dir = await mkdtemp(path.join(tmpdir(), 'reel-'));
  const inFile = path.join(dir, 'bg.png');
  const ovFile = path.join(dir, 'ov.png');
  const outFile = path.join(dir, 'out.mp4');
  try {
    const bg = bgBuffer || (await fetchAsBuffer(bgUrl)).buffer;
    await writeFile(inFile, bg);
    await writeFile(ovFile, overlayBuffer);

    const filter = [
      "[0:v]scale=2160:3840:force_original_aspect_ratio=increase,crop=2160:3840," +
      "zoompan=z='min(zoom+0.0008,1.24)':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)*0.55':d=300:s=1080x1920:fps=30[bg]",
      "[1:v]scale=1080:1920[ov]",
      "[bg][ov]overlay=0:0:format=auto[out]",
    ].join(';');

    await runFfmpeg([
      '-y', '-loop', '1', '-i', inFile, '-loop', '1', '-i', ovFile, '-t', '10', '-r', '30',
      '-filter_complex', filter, '-map', '[out]',
      '-c:v', 'libx264', '-crf', '19', '-preset', 'medium', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', outFile,
    ]);

    const mp4 = await readFile(outFile);
    const uuid = randomUUID();
    const url = await uploadBuffer({ bucket: STORAGE_BUCKET, path: `reels/${jobId}/${uuid}.mp4`, buffer: mp4, contentType: 'video/mp4' });

    // Poster (erstes Frame) für Mail/Portal, wo <video> nicht zuverlässig spielt.
    let posterUrl = null;
    try {
      await runFfmpeg(['-y', '-i', outFile, '-frames:v', '1', '-q:v', '3', posterFile]);
      const poster = await readFile(posterFile);
      posterUrl = await uploadBuffer({ bucket: STORAGE_BUCKET, path: `reels/${jobId}/${uuid}.jpg`, buffer: poster, contentType: 'image/jpeg' });
    } catch (err) { console.warn('[overlayTextOnVideo] Poster fehlgeschlagen:', err.message); }

    return { url, posterUrl };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Legt eine transparente Text-Overlay-Ebene über ein FERTIGES Video (z. B. Higgsfield-Clip).
 * Das Video wird aufs Zielformat skaliert/beschnitten (cover), darüber kommt die statische
 * Overlay-Ebene (Stellentitel/Pill/Logo); die Headline (optional) blendet nach 0,5 s weich ein.
 *
 * @param {{ videoBuffer?:Buffer, videoUrl?:string, staticOverlay:Buffer, hookOverlay?:Buffer|null,
 *           format?:'quadrat'|'feed'|'story', jobId:string }} p
 * @returns {Promise<{ url:string }>}
 */
export async function overlayTextOnVideo({ videoBuffer, videoUrl, staticOverlay, hookOverlay, format = 'story', jobId }) {
  if (!staticOverlay) throw new Error('Keine statische Overlay-Ebene.');
  const dims = FORMAT_DIMS[format] || FORMAT_DIMS.story;
  const W = dims.w, H = dims.h;
  const dir = await mkdtemp(path.join(tmpdir(), 'hfov-'));
  const vidFile = path.join(dir, 'in.mp4');
  const stFile = path.join(dir, 'static.png');
  const hkFile = path.join(dir, 'hook.png');
  const outFile = path.join(dir, 'out.mp4');
  const posterFile = path.join(dir, 'poster.jpg');
  try {
    const vb = videoBuffer || (await fetchAsBuffer(videoUrl)).buffer;
    await writeFile(vidFile, vb);
    await writeFile(stFile, staticOverlay);
    const hasHook = !!hookOverlay;
    if (hasHook) await writeFile(hkFile, hookOverlay);

    // Video auf Zielformat bringen (cover), statische Ebene drauf, dann Headline mit Alpha-Fade.
    const parts = [
      `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=30[v0]`,
      `[1:v]scale=${W}:${H}[st]`,
      `[v0][st]overlay=0:0${hasHook ? '[v1]' : '[out]'}`,
    ];
    if (hasHook) {
      parts.push(`[2:v]scale=${W}:${H},format=rgba,fade=t=in:st=0.5:d=0.4:alpha=1[hk]`);
      parts.push(`[v1][hk]overlay=0:0[out]`);
    }
    const filter = parts.join(';');

    const inputs = ['-i', vidFile, '-loop', '1', '-i', stFile];
    if (hasHook) inputs.push('-loop', '1', '-i', hkFile);

    await runFfmpeg([
      '-y', ...inputs,
      '-filter_complex', filter, '-map', '[out]',
      '-an', '-shortest',
      '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-pix_fmt', 'yuv420p',
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
