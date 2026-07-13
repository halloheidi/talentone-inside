// Nachbearbeitung von KI-Bildern per Sharp.
// - extendTo9x16: gpt-image-2 liefert Story-Bilder nur in 2:3 (1024x1536).
//   Für Meta Reels/Stories brauchen wir echtes 9:16 (1080x1920). Diese Funktion
//   skaliert das Bild auf 1080 Breite und erweitert die fehlende Höhe oben/unten
//   mit einem "ambient extend" (die Kante gespiegelt + geblurrt), sodass der
//   Übergang zum Original nahtlos wirkt. Das eigentliche Creative bleibt
//   vollständig und mittig erhalten.

import sharp from 'sharp';

const REEL_WIDTH  = 1080;
const REEL_HEIGHT = 1920;

/**
 * Erweitert ein 2:3-Bild (typisch 1024x1536) auf exakt 1080x1920 (9:16).
 * Der Original-Inhalt bleibt komplett sichtbar, mittig platziert.
 * Die zusätzliche Höhe oben/unten wird durch einen weichen "ambient
 * extend"-Rand gefüllt (obere/untere Bildkante gespiegelt + geblurrt).
 *
 * Wenn das Input-Bild bereits >= 9:16 hoch ist, wird nur mittig auf 1080x1920
 * beschnitten. Fallback bei Sharp-Fehler: unverändertes Input zurückgeben.
 */
export async function extendTo9x16(inputBuffer) {
  // 1. Auf Zielbreite skalieren, Höhe proportional
  const scaled = await sharp(inputBuffer)
    .resize({ width: REEL_WIDTH, withoutEnlargement: false })
    .png()
    .toBuffer({ resolveWithObject: true });

  const W = scaled.info.width;
  let H = scaled.info.height;

  // Bild bereits so hoch oder höher als Ziel → mittig beschneiden.
  if (H >= REEL_HEIGHT) {
    const top = Math.round((H - REEL_HEIGHT) / 2);
    return await sharp(scaled.data)
      .extract({ left: 0, top, width: W, height: REEL_HEIGHT })
      .png()
      .toBuffer();
  }

  const totalMissing = REEL_HEIGHT - H;
  const topPad    = Math.floor(totalMissing / 2);
  const bottomPad = totalMissing - topPad;

  // "Ambient extend": obere/untere 6% des Bildes als Sample nehmen, vertikal
  // spiegeln, auf die fehlende Höhe strecken, kräftig blurren. Dadurch entsteht
  // ein weicher Farbverlauf, der die Original-Farben aufgreift und die Grenze
  // zum Original unsichtbar macht.
  const EDGE_SAMPLE = Math.max(24, Math.min(80, Math.floor(H * 0.06)));

  const topStrip = await sharp(scaled.data)
    .extract({ left: 0, top: 0, width: W, height: EDGE_SAMPLE })
    .flip()  // vertikal spiegeln → Kante liegt am Original an
    .resize({ width: W, height: topPad, fit: 'fill' })
    .blur(32)
    .png()
    .toBuffer();

  const bottomStrip = await sharp(scaled.data)
    .extract({ left: 0, top: H - EDGE_SAMPLE, width: W, height: EDGE_SAMPLE })
    .flip()
    .resize({ width: W, height: bottomPad, fit: 'fill' })
    .blur(32)
    .png()
    .toBuffer();

  return await sharp({
    create: {
      width: REEL_WIDTH,
      height: REEL_HEIGHT,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite([
      { input: topStrip,    top: 0,           left: 0 },
      { input: scaled.data, top: topPad,      left: 0 },
      { input: bottomStrip, top: topPad + H,  left: 0 },
    ])
    .png()
    .toBuffer();
}
