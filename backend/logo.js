// Zentrales Logo-Handling: Transparenz-Präparation + Sharp-Overlay auf Creatives.
// Alle Creative-Renderings gehen durch composeLogoOverlay — die KI zeichnet nie
// selbst ein Logo, das Original wird pixelgenau aufgesetzt.

import sharp from 'sharp';
import { logoIstHell } from './creative-ci.js';

// Pixel als "weiß" behandeln, wenn alle drei Kanäle >= 240 sind.
// Zusätzlich Toleranz gegenüber leichtem Grau am Anti-Aliasing-Rand.
const WHITE_MIN = 240;
// Farbabstand (euklidisch, 0..441) zum erkannten Rand-Hintergrund, ab dem ein
// Pixel noch als Hintergrund gilt — moderat, damit die Logo-Kanten stehen bleiben.
const EDGE_TOL = 44;

/**
 * Macht den einfarbigen Hintergrund eines Logos transparent und liefert ein
 * PNG mit Alpha-Kanal. Erkennt die dominante Randfarbe und entfernt per
 * Flood-Fill von den Bildrändern genau diesen Hintergrund — so werden sowohl
 * weiße ALS AUCH farbige Hintergründe (z. B. ein dunkles Logo-Rechteck) sauber
 * freigestellt, ohne gleichfarbige Flächen im Logo-Inneren anzufassen.
 *
 * Ist der Rand uneinheitlich (Foto/Verlauf statt Vollfläche), bleibt es beim
 * bewährten, konservativen Weiß-Schwellwert.
 *
 * Idempotent: bereits transparente PNGs werden nicht verschlechtert.
 */
export async function makeTransparent(logoBuffer) {
  const src = sharp(logoBuffer).ensureAlpha();
  const { data, info } = await src.raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;

  const bg = dominanteRandfarbe(data, w, h);

  if (bg && bg.uniform && !istFastWeiss(bg.r, bg.g, bg.b)) {
    // Farbiger, einheitlicher Hintergrund → randbasierter Flood-Fill.
    floodFillHintergrund(data, w, h, bg, EDGE_TOL);
  } else {
    // Weißer (oder uneinheitlicher) Hintergrund → globaler Weiß-Schwellwert.
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r >= WHITE_MIN && g >= WHITE_MIN && b >= WHITE_MIN) data[i + 3] = 0;
    }
  }

  return await sharp(data, {
    raw: { width: w, height: h, channels: 4 },
  }).png().toBuffer();
}

function istFastWeiss(r, g, b) { return r >= WHITE_MIN && g >= WHITE_MIN && b >= WHITE_MIN; }

/**
 * Dominante Randfarbe (Mittel der sichtbaren Rahmenpixel) + Aussage, ob der Rand
 * einfarbig genug ist, um ihn als Hintergrund zu behandeln.
 */
function dominanteRandfarbe(data, w, h) {
  const band = 2;
  let r = 0, g = 0, b = 0, n = 0;
  const acc = (x, y) => {
    const i = (y * w + x) * 4;
    if (data[i + 3] < 32) return;
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
  };
  for (let x = 0; x < w; x++) for (let d = 0; d < band; d++) { acc(x, d); acc(x, h - 1 - d); }
  for (let y = 0; y < h; y++) for (let d = 0; d < band; d++) { acc(d, y); acc(w - 1 - d, y); }
  if (!n) return null;
  r /= n; g /= n; b /= n;

  // Varianz der Rahmenpixel → Einheitlichkeit.
  let varSum = 0, m = 0;
  const vacc = (x, y) => {
    const i = (y * w + x) * 4;
    if (data[i + 3] < 32) return;
    varSum += (data[i] - r) ** 2 + (data[i + 1] - g) ** 2 + (data[i + 2] - b) ** 2; m++;
  };
  for (let x = 0; x < w; x++) for (let d = 0; d < band; d++) { vacc(x, d); vacc(x, h - 1 - d); }
  for (let y = 0; y < h; y++) for (let d = 0; d < band; d++) { vacc(d, y); vacc(w - 1 - d, y); }
  const variance = m ? varSum / m : 1e9;

  return { r: Math.round(r), g: Math.round(g), b: Math.round(b), uniform: variance < 600 };
}

/**
 * Entfernt den vom Bildrand zusammenhängenden Hintergrund (Alpha → 0), solange
 * er nah an der erkannten Randfarbe liegt. Eingeschlossene, gleichfarbige
 * Flächen im Logo-Inneren bleiben erhalten (kein globaler Schwellwert).
 */
function floodFillHintergrund(data, w, h, bg, tol) {
  const tol2 = tol * tol;
  const near = (p) => {
    const i = p * 4;
    const dr = data[i] - bg.r, dg = data[i + 1] - bg.g, db = data[i + 2] - bg.b;
    return dr * dr + dg * dg + db * db <= tol2;
  };
  const visited = new Uint8Array(w * h);
  const stack = [];
  const seed = (x, y) => {
    const p = y * w + x;
    if (!visited[p] && near(p)) { visited[p] = 1; stack.push(p); }
  };
  for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
  for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }
  while (stack.length) {
    const p = stack.pop();
    data[p * 4 + 3] = 0;
    const x = p % w, y = (p - x) / w;
    if (x > 0) seed(x - 1, y);
    if (x < w - 1) seed(x + 1, y);
    if (y > 0) seed(x, y - 1);
    if (y < h - 1) seed(x, y + 1);
  }
}

/**
 * Mittlere Helligkeit der sichtbaren (Alpha > 32) Pixel — 0 = schwarz, 255 = weiß.
 * Wird verwendet um zu entscheiden, ob der Overlay-Backdrop hell (für dunkle
 * Logos) oder dunkel (für helle Logos) sein soll.
 */
export async function logoBrightness(transparentPngBuffer) {
  const { data } = await sharp(transparentPngBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let sum = 0, count = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 32) continue;
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    sum += gray;
    count++;
  }
  return count > 0 ? sum / count : 128;
}

/**
 * Legt das Firmenlogo mit dezentem, halbtransparentem Backdrop auf ein Creative.
 *
 * @param {Buffer} baseBuffer            — das generierte Creative (PNG)
 * @param {Buffer} transparentLogoBuffer — Logo mit transparentem Hintergrund
 * @param {object} [position]            — { x, y, width_pct } als Anteile 0..1
 *                                         x/y = Zentrum des Logos, Default: oben rechts
 *                                         width_pct = Logo-Breite / Bildbreite, Default 0.20
 * @returns {Promise<Buffer>} komponiertes PNG
 */
export async function composeLogoOverlay(baseBuffer, transparentLogoBuffer, position, opts = {}) {
  const { weisseFlaeche = true } = opts; // false → Plakette weglassen, Logo direkt aufs Motiv
  const base = sharp(baseBuffer);
  const meta = await base.metadata();
  const W = meta.width, H = meta.height;
  if (!W || !H) return baseBuffer;

  const widthPct = clamp(position?.width_pct ?? 0.20, 0.05, 0.5);
  const targetLogoWidth = Math.max(32, Math.round(W * widthPct));

  const resized = await sharp(transparentLogoBuffer)
    .resize({ width: targetLogoWidth, withoutEnlargement: false })
    .png()
    .toBuffer({ resolveWithObject: true });
  const lw = resized.info.width;
  const lh = resized.info.height;

  // Default: oben rechts, 3% Rand.
  const defaultCx = 1 - widthPct / 2 - 0.03;
  const defaultCy = (lh / H) / 2 + 0.03;
  const cx = clamp(position?.x ?? defaultCx, 0, 1);
  const cy = clamp(position?.y ?? defaultCy, 0, 1);

  const left = Math.round(W * cx - lw / 2);
  const top  = Math.round(H * cy - lh / 2);

  if (!weisseFlaeche) {
    // Ohne Plakette: transparentes Logo direkt aufs Motiv, darunter ein dezenter
    // weicher Schlagschatten (Lesbarkeits-Netz gegen unruhige Bildbereiche — subtil,
    // kein harter Sticker-Rand).
    const schatten = await weicherSchatten(resized.data, lw, lh);
    const off = Math.max(2, Math.round(Math.min(lw, lh) * 0.03));
    return base.composite([
      { input: schatten.buffer, left: clampInt(left - schatten.pad + off, -schatten.pad, W), top: clampInt(top - schatten.pad + off, -schatten.pad, H) },
      { input: resized.data, left, top },
    ]).png().toBuffer();
  }

  // Regel 3: Logo auf definiertem Grund — weiße Platte, 16px Innenabstand, 12px Radius,
  // (nahezu) deckend. Helle/weiße Logos bekommen einen dunklen Grund, damit sie sichtbar bleiben.
  const pad = 16;
  const backdropW = lw + pad * 2;
  const backdropH = lh + pad * 2;
  const backdropRadius = 12;

  // Regel 3: weiße Platte als Default. Nur ein praktisch WEISSES Logo (das auf
  // Weiß verschwinden würde) bekommt einen dunklen Grund — ein buntes Logo
  // (gelb/blau o. ä.) ist auf Weiß gut lesbar und darf NIE eine schwarze Fläche
  // bekommen. (logoBrightness-Mittelwert war hier zu grob und hat bunte Logos
  // fälschlich als „hell" eingestuft.)
  const hellesLogo = await logoIstHell(transparentLogoBuffer);
  const bgColor = hellesLogo ? 'rgba(20,20,20,0.90)' : 'rgba(255,255,255,0.95)';

  const backdropSvg = Buffer.from(
    `<svg width="${backdropW}" height="${backdropH}" xmlns="http://www.w3.org/2000/svg">
       <rect x="0" y="0" width="${backdropW}" height="${backdropH}"
             rx="${backdropRadius}" ry="${backdropRadius}" fill="${bgColor}"/>
     </svg>`
  );
  const backdropLeft = clampInt(left - pad, -pad, W);
  const backdropTop  = clampInt(top - pad,  -pad, H);

  return base.composite([
    { input: backdropSvg, left: backdropLeft, top: backdropTop },
    { input: resized.data, left, top },
  ]).png().toBuffer();
}

/**
 * Erzeugt aus einem RGBA-Logo einen weichen, halbtransparenten Schlagschatten:
 * die Logo-Silhouette (Alpha) in Schwarz, mit Rand versehen und weichgezeichnet.
 * @returns {{ buffer: Buffer, pad: number }} pad = zusätzlicher Rand rund ums Logo
 */
async function weicherSchatten(logoRgbaBuffer, lw, lh) {
  const pad = Math.max(6, Math.round(Math.min(lw, lh) * 0.12));
  const sigma = Math.max(2, Math.round(Math.min(lw, lh) * 0.06));
  const { data, info } = await sharp(logoRgbaBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // Schwarze Silhouette mit gedämpftem Alpha (max. ~50 %).
  const sil = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 4) {
    sil[i] = 0; sil[i + 1] = 0; sil[i + 2] = 0;
    sil[i + 3] = Math.round((data[i + 3] / 255) * 0.5 * 255);
  }
  // Auf gepolstertes, transparentes Canvas legen, dann weichzeichnen.
  const silPng = await sharp(sil, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  const buffer = await sharp({ create: { width: lw + pad * 2, height: lh + pad * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: silPng, left: pad, top: pad }])
    .blur(sigma)
    .png()
    .toBuffer();
  return { buffer, pad };
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function clampInt(v, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(v))); }

/**
 * Präpariert das Kunden-Logo (weiß→transparent) und lädt es in den
 * talentone-logos-Bucket unter kunde_id/transparent-...png. Setzt danach
 * kunde.logo_transparent_url. Idempotent (überschreibt vorherige URL).
 *
 * @param {string} kundeId
 * @param {Buffer} originalLogoBuffer
 * @param {object} deps  — { supabase, uploadBuffer, deleteFromBucket? }
 * @returns {Promise<string>} publicUrl der transparenten Version
 */
export async function prepareAndSaveTransparentLogo(kundeId, originalLogoBuffer, deps) {
  const { supabase, uploadBuffer, deleteFromBucket } = deps;
  const transparent = await makeTransparent(originalLogoBuffer);
  const path = `${kundeId}/transparent-${Date.now()}.png`;
  const publicUrl = await uploadBuffer({
    bucket: 'talentone-logos', path, buffer: transparent, contentType: 'image/png',
  });

  // Alte transparente Version aufräumen, falls vorhanden
  if (deleteFromBucket) {
    try {
      const { data: prev } = await supabase.from('talentone_kunden')
        .select('logo_transparent_url').eq('id', kundeId).maybeSingle();
      if (prev?.logo_transparent_url && prev.logo_transparent_url !== publicUrl) {
        await deleteFromBucket('talentone-logos', prev.logo_transparent_url);
      }
    } catch (err) { console.warn('[logo-prep] cleanup skip:', err.message); }
  }

  await supabase.from('talentone_kunden')
    .update({ logo_transparent_url: publicUrl }).eq('id', kundeId);
  return publicUrl;
}
