// Zentrales Logo-Handling: Transparenz-Präparation + Sharp-Overlay auf Creatives.
// Alle Creative-Renderings gehen durch composeLogoOverlay — die KI zeichnet nie
// selbst ein Logo, das Original wird pixelgenau aufgesetzt.

import sharp from 'sharp';

// Pixel als "weiß" behandeln, wenn alle drei Kanäle >= 240 sind.
// Zusätzlich Toleranz gegenüber leichtem Grau am Anti-Aliasing-Rand.
const WHITE_MIN = 240;

/**
 * Macht den weißen/nahezu-weißen Hintergrund eines Logos transparent.
 * Liefert einen PNG-Buffer mit Alpha-Kanal.
 *
 * Idempotent: bereits transparente PNGs werden nicht verschlechtert.
 */
export async function makeTransparent(logoBuffer) {
  const src = sharp(logoBuffer).ensureAlpha();
  const { data, info } = await src.raw().toBuffer({ resolveWithObject: true });

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (r >= WHITE_MIN && g >= WHITE_MIN && b >= WHITE_MIN) {
      data[i + 3] = 0;
    }
  }

  return await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  }).png().toBuffer();
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
export async function composeLogoOverlay(baseBuffer, transparentLogoBuffer, position) {
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

  // Backdrop: abgerundetes Rechteck hinter dem Logo. Farbe je nach Logo-Helligkeit.
  const pad = Math.round(Math.min(lw, lh) * 0.18);
  const backdropW = lw + pad * 2;
  const backdropH = lh + pad * 2;
  const backdropRadius = Math.round(Math.min(backdropW, backdropH) * 0.18);

  const brightness = await logoBrightness(transparentLogoBuffer);
  const isDarkLogo = brightness < 128;
  const bgColor = isDarkLogo ? 'rgba(255,255,255,0.75)' : 'rgba(20,20,20,0.55)';

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
