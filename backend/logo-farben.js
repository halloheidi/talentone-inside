// Exakte Farbpalette aus dem (transparenten) Logo — Sharp, ohne Approximation.
// Clustert nur NICHT-transparente Pixel und mittelt je Cluster den echten Farbwert
// (nicht den Bin-Mittelpunkt), damit der Hex exakt der Logofarbe entspricht.
// Rückgabe: [{ hex, anteil }] (Flächenanteil in %, 3–5 dominante Farben).

import sharp from 'sharp';
import { fetchAsBuffer } from './storage.js';

function toHex(r, g, b) {
  const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
function dist(a, b) { return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2); }

export async function extractLogoPalette(buffer, { maxColors = 5, minAnteil = 0.02, mergeDist = 44 } = {}) {
  const { data } = await sharp(buffer)
    .resize(200, 200, { fit: 'inside', withoutEnlargement: false })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const bins = new Map();
  let opaque = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;              // transparente/Halo-Pixel raus
    opaque++;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);   // 5-bit-Bin nur fürs Clustern
    let e = bins.get(key);
    if (!e) { e = { count: 0, sr: 0, sg: 0, sb: 0 }; bins.set(key, e); }
    e.count++; e.sr += r; e.sg += g; e.sb += b;
  }
  if (!opaque) return { farben: [], opaque: 0 };

  let clusters = [...bins.values()].map(e => ({ count: e.count, r: e.sr / e.count, g: e.sg / e.count, b: e.sb / e.count }));
  clusters.sort((a, b) => b.count - a.count);

  const merged = [];
  for (const c of clusters) {
    const near = merged.find(m => dist(m, c) < mergeDist);
    if (near) {
      const tot = near.count + c.count;
      near.r = (near.r * near.count + c.r * c.count) / tot;
      near.g = (near.g * near.count + c.g * c.count) / tot;
      near.b = (near.b * near.count + c.b * c.count) / tot;
      near.count = tot;
    } else merged.push({ ...c });
  }
  merged.sort((a, b) => b.count - a.count);

  const farben = merged
    .map(c => ({ hex: toHex(c.r, c.g, c.b), anteil: c.count / opaque }))
    .filter(c => c.anteil >= minAnteil)
    .slice(0, maxColors)
    .map(c => ({ hex: c.hex, anteil: Math.round(c.anteil * 1000) / 10 }));
  return { farben, opaque };
}

/** Convenience: Palette direkt aus einer Logo-URL (bevorzugt logo_transparent_url). */
export async function extractLogoPaletteFromUrl(url, opts) {
  if (!url) throw new Error('Keine Logo-URL.');
  const { buffer } = await fetchAsBuffer(url);
  return extractLogoPalette(buffer, opts);
}
