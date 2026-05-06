// Farb-Extraktion aus URL (Puppeteer) und aus Bild (sharp).
// Gibt jeweils ein Objekt zurück: { primaer, sekundaer, akzent }, alle als Hex (#rrggbb).

import sharp from 'sharp';

/* ───────────────────────── Helpers ───────────────────────── */

function rgbToHex(r, g, b) {
  const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

// Parsed CSS-Farben (rgb/rgba/#hex/Schlüsselwörter sehr basic) → {r,g,b} oder null
function parseCssColor(value) {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (v === 'transparent' || v === 'inherit' || v === 'initial' || v === 'currentcolor' || v === 'none') return null;

  // #rrggbb / #rgb
  let m = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (m) {
    const h = m[1];
    if (h.length === 3) return { r: parseInt(h[0]+h[0],16), g: parseInt(h[1]+h[1],16), b: parseInt(h[2]+h[2],16) };
    return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16) };
  }
  // rgb(…) / rgba(…)
  m = v.match(/^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?\s*\)$/);
  if (m) {
    const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
    if (a < 0.2) return null;
    return { r: +m[1], g: +m[2], b: +m[3] };
  }
  // hsl(…) / hsla(…)
  m = v.match(/^hsla?\s*\(\s*(\d+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%(?:\s*,\s*([0-9.]+))?\s*\)$/);
  if (m) {
    const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
    if (a < 0.2) return null;
    return hslToRgb(+m[1], +m[2] / 100, +m[3] / 100);
  }
  return null;
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r1, g1, b1;
  if (h < 60) [r1,g1,b1] = [c,x,0];
  else if (h < 120) [r1,g1,b1] = [x,c,0];
  else if (h < 180) [r1,g1,b1] = [0,c,x];
  else if (h < 240) [r1,g1,b1] = [0,x,c];
  else if (h < 300) [r1,g1,b1] = [x,0,c];
  else [r1,g1,b1] = [c,0,x];
  return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 };
}

// Filtert "uninteressante" Farben (zu nah an Weiß/Schwarz/Grau)
function isInteresting({ r, g, b }, { allowDark = false } = {}) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < (allowDark ? 12 : 28)) return false;        // zu schwarz
  if (min > 232) return false;                          // zu weiß
  if (max - min < 18) return false;                     // zu grau
  return true;
}

// Distanz im RGB-Würfel — für Dedup
function colorDistance(a, b) {
  return Math.sqrt((a.r-b.r)**2 + (a.g-b.g)**2 + (a.b-b.b)**2);
}

// Wählt aus einer count-sortierten Liste 3 sich klar unterscheidende Farben.
function pickThree(rankedRgb) {
  const out = [];
  for (const c of rankedRgb) {
    if (out.every(o => colorDistance(o, c) > 60)) {
      out.push(c);
      if (out.length >= 3) break;
    }
  }
  return out;
}

function toFarbenObject(rgbList) {
  const [primaer, sekundaer, akzent] = rgbList;
  const obj = {};
  if (primaer)  obj.primaer  = rgbToHex(primaer.r,  primaer.g,  primaer.b);
  if (sekundaer) obj.sekundaer = rgbToHex(sekundaer.r, sekundaer.g, sekundaer.b);
  if (akzent)   obj.akzent    = rgbToHex(akzent.r,   akzent.g,   akzent.b);
  return Object.keys(obj).length ? obj : null;
}

/* ───────────────────────── URL → Farben ───────────────────────── */

export async function extractColorsFromUrl(url) {
  const puppeteer = (await import('puppeteer')).default;
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  let raw;
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (compatible; TalentOneInsideBot/1.0)');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });

    raw = await page.evaluate(() => {
      const out = { themeColor: null, cssVars: [], elementColors: [] };

      // Meta theme-color
      const metaTC = document.querySelector('meta[name="theme-color"]');
      if (metaTC) out.themeColor = metaTC.getAttribute('content');

      // CSS-Variablen, die nach Brand/Color klingen
      const rootStyles = getComputedStyle(document.documentElement);
      const VAR_RE = /color|brand|primary|primaer|secondary|sekund|accent|akzent|theme/i;
      for (let i = 0; i < rootStyles.length; i++) {
        const name = rootStyles[i];
        if (name.startsWith('--') && VAR_RE.test(name)) {
          const val = rootStyles.getPropertyValue(name).trim();
          if (val) out.cssVars.push({ name, value: val });
        }
      }

      // Häufigste Farben aus prominenten Elementen
      const counts = {};
      const sels = 'a,button,h1,h2,h3,header,nav,main,.btn,.button,.cta,[class*="primary"],[class*="brand"]';
      const els = Array.from(document.querySelectorAll(sels)).slice(0, 250);
      for (const el of els) {
        const cs = getComputedStyle(el);
        for (const prop of ['background-color', 'color', 'border-color']) {
          const v = cs.getPropertyValue(prop);
          if (v) counts[v] = (counts[v] || 0) + 1;
        }
      }
      out.elementColors = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([value, count]) => ({ value, count }));

      return out;
    });
  } finally {
    await browser.close();
  }

  // Server-seitig auswerten
  const cssVarColors = (raw.cssVars || [])
    .map(v => parseCssColor(v.value))
    .filter(Boolean)
    .filter(c => isInteresting(c));
  const themeColor = raw.themeColor ? parseCssColor(raw.themeColor) : null;
  const elementColors = (raw.elementColors || [])
    .map(({ value, count }) => ({ rgb: parseCssColor(value), count }))
    .filter(x => x.rgb && isInteresting(x.rgb));

  // Ranking: theme + cssVars zuerst (hohe semantische Sicherheit), dann häufigste Element-Farben
  const ranked = [];
  if (themeColor && isInteresting(themeColor)) ranked.push(themeColor);
  for (const c of cssVarColors) ranked.push(c);
  for (const x of elementColors) ranked.push(x.rgb);

  const picked = pickThree(ranked);
  return toFarbenObject(picked);
}

/* ───────────────────────── Bild → Farben ───────────────────────── */

export async function extractColorsFromImageBuffer(buffer) {
  // Resize auf max 96×96 für schnelle Analyse, RGBA-raw
  const { data } = await sharp(buffer)
    .resize(96, 96, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // 5-bit pro Kanal Quantisierung → 32768 Bins
  const counts = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 128) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const bin = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    counts.set(bin, (counts.get(bin) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  const ranked = [];
  for (const [bin] of sorted) {
    const r = ((bin >> 10) & 0x1F) * 8;
    const g = ((bin >> 5)  & 0x1F) * 8;
    const b = (bin         & 0x1F) * 8;
    const rgb = { r, g, b };
    if (!isInteresting(rgb, { allowDark: true })) continue;
    ranked.push(rgb);
    if (ranked.length >= 30) break;
  }

  const picked = pickThree(ranked);
  return toFarbenObject(picked);
}
