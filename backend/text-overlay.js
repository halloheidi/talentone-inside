// Strikt-Modus Text-Overlay: rendert markenfarbige Schriftzüge deterministisch
// (Puppeteer + eingebettete Display-Fonts) mit EXAKTEN Akten-Hexwerten auf ein
// neutrales Foto-Motiv. 4 Typo-Presets. Kein Aufhellen/Shiften der Markenfarbe.
// Danach ein Farb-Check (Assertion, kein Toleranzband): der exakte Hex MUSS als
// zusammenhängende Fläche im Ergebnis vorkommen.

import sharp from 'sharp';
import { FONT_FACE_CSS, FONT_STACK } from './fonts.js';

const FORMAT_DIMS = {
  quadrat: { w: 1080, h: 1080 },
  feed:    { w: 1080, h: 1350 },
  story:   { w: 1080, h: 1920 },
};
const SAFE = {
  story:   { top: 300, bottom: 340 },
  feed:    { top: 90,  bottom: 90 },
  quadrat: { top: 70,  bottom: 70 },
};

export const TEXT_STILE = [
  { id: 'neon',    name: 'Neon-Glow',  beschreibung: 'Versalien mit weichem, mehrschichtigem Schein in Markenfarbe.' },
  { id: 'balken',  name: 'Balken',     beschreibung: 'Weiße Bold-Schrift auf Markenfarb-Balken je Zeile, leicht versetzt.' },
  { id: 'outline', name: 'Outline',    beschreibung: 'Markenfarbe mit feiner Kontur und hartem Schlagschatten.' },
  { id: 'clean',   name: 'Clean Bold', beschreibung: 'Massive Display-Schrift, dezenter Schatten.' },
];
const STIL_IDS = new Set(TEXT_STILE.map(s => s.id));
export function normStil(id) { return STIL_IDS.has(id) ? id : 'clean'; }

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function dim(hex, a) { const c = hexToRgb(hex); return c ? `rgba(${c.r},${c.g},${c.b},${a})` : `rgba(0,0,0,${a})`; }
function pickInk(hex) {
  const c = hexToRgb(hex); if (!c) return '#ffffff';
  return (0.2126 * c.r + 0.7152 * c.g + 0.114 * c.b) / 255 > 0.6 ? '#0a0a0a' : '#ffffff';
}

// Baut den Schriftzug-Block je Preset. accent = EXAKTER Akten-Hex (nie verändert).
function buildLinesHtml(zeilen, stil, accent, fontMax) {
  const rows = zeilen.map((line, i) => {
    const txt = escapeHtml(line);
    if (stil === 'balken') {
      const ink = pickInk(accent);
      return `<div data-fit style="align-self:flex-start;max-width:100%;margin-left:${i * 34}px;background:${accent};color:${ink};
        font-family:${FONT_STACK.archivo};font-size:${fontMax}px;line-height:1.06;padding:8px 22px;border-radius:8px;
        white-space:nowrap;overflow:hidden;text-transform:uppercase;box-shadow:0 10px 30px rgba(0,0,0,0.35);">${txt}</div>`;
    }
    if (stil === 'neon') {
      return `<div data-fit style="font-family:${FONT_STACK.anton};font-size:${fontMax}px;line-height:1.02;letter-spacing:0.01em;
        text-transform:uppercase;color:${accent};
        text-shadow:0 0 6px ${accent},0 0 18px ${accent},0 0 42px ${dim(accent, 0.85)},0 0 80px ${dim(accent, 0.6)};">${txt}</div>`;
    }
    if (stil === 'outline') {
      return `<div data-fit style="font-family:${FONT_STACK.archivo};font-size:${fontMax}px;line-height:1.04;
        text-transform:uppercase;color:${accent};-webkit-text-stroke:3px #ffffff;paint-order:stroke fill;
        text-shadow:5px 5px 0 rgba(0,0,0,0.55);">${txt}</div>`;
    }
    // clean
    return `<div data-fit style="font-family:${FONT_STACK.archivo};font-size:${fontMax}px;line-height:1.02;letter-spacing:-0.01em;
      text-transform:uppercase;color:${accent};text-shadow:0 4px 14px rgba(0,0,0,0.5);">${txt}</div>`;
  });
  return rows.join('<div style="height:10px"></div>');
}

function autofitScript() {
  document.querySelectorAll('[data-fit]').forEach(el => {
    let size = parseFloat(getComputedStyle(el).fontSize) || 120;
    let guard = 0;
    while (size > 30 && guard < 200 && el.scrollWidth > el.clientWidth + 1) { size -= 2; el.style.fontSize = size + 'px'; guard++; }
  });
}

/**
 * Rendert die Schriftzug-Ebene und legt sie auf das (neutrale) Basisbild.
 * @returns {Promise<Buffer>} PNG des fertigen Creatives.
 */
export async function renderTextOverlay({ baseBuffer, format = 'quadrat', stil = 'clean', hook, accent }) {
  const dims = FORMAT_DIMS[format] || FORMAT_DIMS.quadrat;
  const safe = SAFE[format] || SAFE.quadrat;
  const zeilen = String(hook || '').split('\n').map(l => l.trim()).filter(Boolean);
  if (!zeilen.length || !accent) return baseBuffer;
  const s = normStil(stil);

  // Basis exakt auf Zielgröße (kein Stretch der Semantik — Motiv ist bereits im Format).
  const base = await sharp(baseBuffer).resize(dims.w, dims.h, { fit: 'cover' }).png().toBuffer();
  const baseUri = `data:image/png;base64,${base.toString('base64')}`;
  const fontMax = format === 'story' ? 120 : format === 'feed' ? 104 : 96;

  const scrim = s === 'balken' ? '' :
    `<div style="position:absolute;left:0;right:0;top:0;height:${Math.round(dims.h * 0.5)}px;
       background:linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 100%);"></div>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    ${FONT_FACE_CSS}
    *{margin:0;padding:0;box-sizing:border-box;}
  </style></head>
  <body style="width:${dims.w}px;height:${dims.h}px;position:relative;overflow:hidden;background:#000;">
    <img src="${baseUri}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;">
    ${scrim}
    <div style="position:absolute;left:56px;right:56px;top:${safe.top}px;display:flex;flex-direction:column;align-items:flex-start;z-index:2;">
      ${buildLinesHtml(zeilen, s, accent, fontMax)}
    </div>
  </body></html>`;

  const puppeteer = (await import('puppeteer')).default;
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: dims.w, height: dims.h, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await page.evaluate(autofitScript);
    const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: dims.w, height: dims.h } });
    return Buffer.from(png);
  } finally {
    await browser.close();
  }
}

/**
 * Farb-Assertion ohne Toleranzband: zählt Pixel, die EXAKT einem der Hexwerte
 * entsprechen. Gibt pro Hex den Count + ok zurück (ok = mind. `minPixel` exakte Pixel).
 */
export async function assertExactColors(buffer, hexList, { minPixel = 40 } = {}) {
  const ziele = (hexList || []).map(hexToRgb).map((c, i) => ({ hex: hexList[i], c })).filter(x => x.c);
  if (!ziele.length) return { ok: true, treffer: [] };
  const { data } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const counts = new Array(ziele.length).fill(0);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 250) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    for (let k = 0; k < ziele.length; k++) {
      const c = ziele[k].c;
      if (r === c.r && g === c.g && b === c.b) { counts[k]++; break; }
    }
  }
  const treffer = ziele.map((z, k) => ({ hex: z.hex, exakte_pixel: counts[k], ok: counts[k] >= minPixel }));
  return { ok: treffer.some(t => t.ok), treffer };
}
