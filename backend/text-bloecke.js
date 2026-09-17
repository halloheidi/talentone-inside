// Gemeinsamer Katalog der verschiebbaren Textblöcke für Sharp-gerenderte
// Creatives (Layout-Vorlagen A/B + Strikt-Text-Overlay). EINE Quelle für
// Renderer, Re-Render-Endpoint und Frontend-Dialog, damit Vorschau (CSS-Proxy)
// und Server-Render (Puppeteer) deckungsgleich bleiben.
//
// Positions-Semantik: (x, y) = Top-Left-Anker des Block-Kastens in 0..1 der
// Leinwand; w = Kastenbreite in 0..1; scale = Schriftgrad-Faktor (Autofit
// verkleinert weiterhin nur, wenn der Text die Kastenbreite sprengt). align =
// Textausrichtung im Kasten.

export const FORMAT_DIMS = {
  quadrat: { w: 1080, h: 1080 },
  feed:    { w: 1080, h: 1350 },
  story:   { w: 1080, h: 1920 },
};

// Safe-Zonen (Pixel) — 9:16 reserviert oben/unten für Meta-Overlays. Deckungs-
// gleich mit layout-vorlagen.js/text-overlay.js, hier zentral für Clamping.
export const SAFE = {
  story:   { top: 260, bottom: 340 },
  feed:    { top: 64,  bottom: 64 },
  quadrat: { top: 48,  bottom: 48 },
};

export function safeFrac(format) {
  const d = FORMAT_DIMS[format] || FORMAT_DIMS.quadrat;
  const s = SAFE[format] || SAFE.quadrat;
  return { top: s.top / d.h, bottom: s.bottom / d.h };
}

// Block-Metadaten je Renderer-Art/Vorlage. baseFont = Startschriftgrad (px),
// autofitMin = Untergrenze; die konkrete Default-Position kommt aus
// defaultPos() (formatabhängig via Safe-Zone).
const CATALOG = {
  'layout:A': [
    { key: 'hook',   label: 'Hook / Frage',   baseFont: 52,  autofitMin: 26, align: 'left'   },
    { key: 'stelle', label: 'Stellentitel',   baseFont: 150, autofitMin: 60, align: 'left'   },
    { key: 'pill',   label: 'Info-Pille',     baseFont: 30,  autofitMin: 20, align: 'left'   },
  ],
  'layout:B': [
    { key: 'textblock', label: 'Textblock',   baseFont: 76,  autofitMin: 34, align: 'right'  },
    { key: 'stelle',    label: 'Stellentitel',baseFont: 120, autofitMin: 52, align: 'center' },
    { key: 'pill',      label: 'Info-Pille',  baseFont: 30,  autofitMin: 20, align: 'center' },
  ],
  'strikt': [
    { key: 'hook', label: 'Schriftzug', baseFont: 96, autofitMin: 30, align: 'left' },
  ],
};

// Vertikale Default-Offsets (relativ zur oberen Safe-Zone bzw. zum unteren Rand).
// Auf die aktuellen Renders abgestimmt, damit „ohne Feinjustage" ~ bisher aussieht.
const DEFAULT_LAYOUT = {
  'layout:A': {
    hook:   { fromTop: 0.00, x: 0.055, w: 0.86 },
    stelle: { fromTop: 0.22, x: 0.055, w: 0.89 },
    pill:   { fromTop: 0.50, x: 0.055, w: 0.89 },
  },
  'layout:B': {
    textblock: { fromTop: 0.14,    x: 0.44,  w: 0.50 },
    stelle:    { fromBottom: 0.20, x: 0.05,  w: 0.90 },
    pill:      { fromBottom: 0.07, x: 0.05,  w: 0.90 },
  },
  'strikt': {
    hook: { fromTop: 0.00, x: 0.052, w: 0.90 },
  },
};

export function catalogKey(kind, vorlage) {
  return kind === 'layout' ? `layout:${vorlage}` : 'strikt';
}

export function blockDefs(kind, vorlage) {
  return CATALOG[catalogKey(kind, vorlage)] || [];
}

// Formatabhängige Default-Positionen (Top-Left-Anker) je Block.
export function defaultPositionen(kind, vorlage, format) {
  const ck = catalogKey(kind, vorlage);
  const defs = CATALOG[ck] || [];
  const layout = DEFAULT_LAYOUT[ck] || {};
  const sf = safeFrac(format);
  const out = {};
  for (const def of defs) {
    const l = layout[def.key] || { fromTop: 0, x: 0.055, w: 0.88 };
    let y;
    if (l.fromBottom != null) y = 1 - sf.bottom - l.fromBottom;
    else y = sf.top + (l.fromTop || 0);
    out[def.key] = { x: l.x, y, w: l.w, scale: 1, align: def.align };
  }
  return out;
}

// Merge: Defaults + gespeicherte Overrides (nur x/y/scale übernommen; w/align
// bleiben Vorlagen-fest). Clamped in die Safe-Zone.
export function mergePositionen(kind, vorlage, format, overrides) {
  const base = defaultPositionen(kind, vorlage, format);
  const ov = overrides || {};
  const sf = safeFrac(format);
  for (const key of Object.keys(base)) {
    const o = ov[key];
    if (!o) continue;
    if (Number.isFinite(o.x)) base[key].x = clamp(o.x, 0, 1 - 0.02);
    if (Number.isFinite(o.y)) base[key].y = clamp(o.y, sf.top, 1 - sf.bottom - 0.03);
    if (Number.isFinite(o.scale)) base[key].scale = clamp(o.scale, 0.5, 1.6);
  }
  return base;
}

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Proportionale Übernahme beim Format-Ableiten: x bleibt, y wird von der
// „Inhaltszone" (zwischen den Safe-Zonen) des Quellformats in die des
// Zielformats umgerechnet; scale bleibt. Ergebnis wird geclamped.
export function transponierePositionen(overrides, fromFormat, toFormat) {
  if (!overrides || typeof overrides !== 'object') return null;
  const a = safeFrac(fromFormat), b = safeFrac(toFormat);
  const spanA = Math.max(0.001, 1 - a.top - a.bottom);
  const spanB = Math.max(0.001, 1 - b.top - b.bottom);
  const out = {};
  for (const [key, o] of Object.entries(overrides)) {
    if (!o) continue;
    const rel = ((Number.isFinite(o.y) ? o.y : a.top) - a.top) / spanA; // 0..1 in Inhaltszone
    const y = clamp(b.top + rel * spanB, b.top, 1 - b.bottom - 0.03);
    out[key] = { ...(Number.isFinite(o.x) ? { x: o.x } : {}), y, ...(Number.isFinite(o.scale) ? { scale: o.scale } : {}) };
  }
  return out;
}
