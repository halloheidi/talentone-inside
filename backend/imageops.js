// Bildverarbeitung per Sharp — Vor- und Nachbearbeitung rund um die OpenAI-Bild-APIs.
//
// - normalizeImageForOpenAI: bringt EINGEHENDE Bilder in ein Format, das
//   /images/edits akzeptiert (siehe unten). Muss vor JEDEM Upload laufen.
// - extendTo9x16: gpt-image-2 liefert Story-Bilder nur in 2:3 (1024x1536).
//   Für Meta Reels/Stories brauchen wir echtes 9:16 (1080x1920). Diese Funktion
//   skaliert das Bild auf 1080 Breite und erweitert die fehlende Höhe oben/unten
//   mit einem "ambient extend" (die Kante gespiegelt + geblurrt), sodass der
//   Übergang zum Original nahtlos wirkt. Das eigentliche Creative bleibt
//   vollständig und mittig erhalten.

import sharp from 'sharp';

const REEL_WIDTH  = 1080;
const REEL_HEIGHT = 1920;

// OpenAI /images/edits akzeptiert nur PNG/JPEG/WebP in RGB, <50MB, max 4096px.
// 2048 ist bewusst konservativ: kleiner als das Limit, aber weit ueber der
// Aufloesung, die gpt-image-2 tatsaechlich auswertet.
const OPENAI_MAX_PIXEL = 2048;

/**
 * Fehler bei einem Bild, das sich nicht fuer OpenAI aufbereiten laesst.
 * Traegt eine fertige, nutzerlesbare Meldung — damit Routen nicht das rohe
 * Sharp-/OpenAI-Innenleben ins Frontend durchreichen muessen.
 */
export class UnsupportedImageError extends Error {
  constructor(label, ursache) {
    super(`Bild "${label}" konnte nicht verarbeitet werden: ${ursache}`);
    this.name = 'UnsupportedImageError';
    this.label = label;
    this.userMessage = `Das Bild „${label}" konnte nicht verarbeitet werden — bitte ein anderes Format hochladen (JPG oder PNG).`;
  }
}

// Gemeinsamer Kern beider Normalisierer: EXIF-Rotation einbrennen (sonst liegt
// das iPhone-Bild quer), CMYK/Graustufen -> sRGB, unter das Groessenlimit
// verkleinern (nie hochskalieren). failOn:'none' dekodiert auch leicht defekte
// Dateien, statt an einer Warnung abzubrechen.
function baseSharp(buffer, maxPixel) {
  return sharp(buffer, { failOn: 'none' })
    .rotate()
    .toColourspace('srgb')
    .resize({ width: maxPixel, height: maxPixel, fit: 'inside', withoutEnlargement: true });
}

/**
 * Normalisiert ein Bild fuer die OpenAI-Bild-APIs (Laufzeit-Sicherheitsnetz).
 *
 * Referenzbilder kommen oft direkt vom iPhone (HEIC), aus InDesign/Print
 * (CMYK-JPEG) oder als 6000px-Kameradatei — alle drei lehnt OpenAI mit
 * 400 "invalid_image_file" bzw. "Invalid image" ab. Ausgabe immer PNG:
 * einheitliches Format, und Transparenz (Logos!) bleibt erhalten.
 *
 * @param {Buffer} buffer  Rohes Bild
 * @param {object} [opts]
 * @param {string} [opts.label]  Name fuer Fehlermeldungen, z.B. 'Firmenlogo'
 * @returns {Promise<{buffer: Buffer, contentType: string, ext: string}>}
 * @throws {UnsupportedImageError}
 */
export async function normalizeImageForOpenAI(buffer, { label = 'Bild' } = {}) {
  try {
    const out = await baseSharp(buffer, OPENAI_MAX_PIXEL).png().toBuffer();
    return { buffer: out, contentType: 'image/png', ext: 'png' };
  } catch (err) {
    throw new UnsupportedImageError(label, err.message);
  }
}

// Gespeicherte Originale duerfen groesser sein als der OpenAI-Upload — sie
// dienen auch Tool-Vorschau und Canva-Download. 4096 ist grosszuegig, aber
// noch im Rahmen (das Laufzeit-Netz verkleinert fuer OpenAI ohnehin auf 2048).
const STORAGE_MAX_PIXEL = 4096;

/**
 * Normalisiert ein Bild BEIM UPLOAD, bevor es im Storage landet. Damit sind
 * gespeicherte Logos/Fotos schon sauber: sRGB, korrekt gedreht (EXIF), web-
 * taugliches Format — schnellere Generierung (keine Wiederhol-Konvertierung),
 * richtig gedrehte Vorschauen im Tool, Canva-taugliche Downloads.
 *
 * Format-Wahl:
 *   - kind='logo' ODER Bild mit Alpha -> PNG (Transparenz muss bleiben)
 *   - sonst (Fotos ohne Alpha)        -> JPEG q88 (deutlich kleiner als PNG)
 *
 * @param {Buffer} buffer
 * @param {object} [opts]
 * @param {'logo'|'foto'} [opts.kind]
 * @param {string} [opts.label]
 * @returns {Promise<{buffer: Buffer, contentType: string, ext: string}>}
 * @throws {UnsupportedImageError}
 */
export async function normalizeImageForStorage(buffer, { kind = 'foto', label = 'Bild' } = {}) {
  try {
    const meta = await sharp(buffer, { failOn: 'none' }).metadata();
    const pipe = baseSharp(buffer, STORAGE_MAX_PIXEL);
    if (kind === 'logo' || meta.hasAlpha) {
      return { buffer: await pipe.png().toBuffer(), contentType: 'image/png', ext: 'png' };
    }
    return { buffer: await pipe.jpeg({ quality: 88 }).toBuffer(), contentType: 'image/jpeg', ext: 'jpg' };
  } catch (err) {
    throw new UnsupportedImageError(label, err.message);
  }
}

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
