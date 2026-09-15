// Eingebettete Display-Fonts für die Sharp/Puppeteer-Text-Overlays (Strikt-Modus).
// Als base64-@font-face einmalig geladen, damit Chromium ohne Datei-/Netzzugriff rendert.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
function load(file) {
  try { return readFileSync(join(HERE, 'assets', 'fonts', file)).toString('base64'); }
  catch { return null; }
}

const ANTON   = load('Anton-Regular.ttf');
const ARCHIVO = load('ArchivoBlack-Regular.ttf');
const OSWALD  = load('Oswald.ttf');

function face(family, b64, weight = 400) {
  return b64 ? `@font-face{font-family:'${family}';src:url(data:font/ttf;base64,${b64}) format('truetype');font-weight:${weight};font-style:normal;font-display:block;}` : '';
}

// In den <style> jedes Text-Overlays einsetzen.
export const FONT_FACE_CSS = [
  face('Anton', ANTON),
  face('Archivo Black', ARCHIVO),
  face('Oswald', OSWALD, 700),
].filter(Boolean).join('\n');

// Font-Stack je Preset (Fallback auf ttf-freefont im Container).
export const FONT_STACK = {
  anton:   `'Anton', 'Oswald', 'Arial Narrow', sans-serif`,
  archivo: `'Archivo Black', 'Liberation Sans', Arial, sans-serif`,
  oswald:  `'Oswald', 'Arial Narrow', sans-serif`,
};
