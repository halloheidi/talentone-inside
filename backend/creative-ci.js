// Gemeinsame CI-/Kompositions-Regeln für ALLE Creative-Renderer
// (Layout-Vorlagen A/B, Strikt-Text-Overlay, V2-Szenen-Komposition, Legacy-Overlay).
//
// Setzt die verbindlichen Layout-Regeln um — eine Quelle, damit jede Vorlage
// identisch rendert:
//  1. Kein globales Abdunkeln des Fotos (max. 10 %, nur wenn das Foto sehr hell ist).
//  2. Lesbarkeit NUR lokal: weicher Verlauf hinter Textzonen ODER Textplatte — nie beides,
//     nie Vollfläche.
//  3. Logo immer auf definiertem Grund (weiße Platte 16px/12px ODER CI-/Weiß-Balken).
//  4. CI-Farben EXAKT aus talentone_kunden.farben (Primär/Sekundär/Akzent) — keine
//     Approximation, kein Aufhellen. Füllfarbe wählt die kräftigste CI-Farbe, wenn primär
//     zu blass für eine Fläche ist (behebt z. B. K&S-Rosa → K&S-Rot).
//  5. Textfarbe automatisch mit Kontrast ≥ 4.5:1; kein Glow / kein Farbschein.

import sharp from 'sharp';

/* ───────────────────────── Farb-Grundlagen ───────────────────────── */

export function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '').trim();
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
export function isHex(hex) { return !!hexToRgb(hex); }
export function rgba(hex, a) { const c = hexToRgb(hex); return c ? `rgba(${c.r},${c.g},${c.b},${a})` : `rgba(0,0,0,${a})`; }

// „Buntheit" (max-min der RGB-Kanäle) — hoch = kräftig, niedrig = grau/weiß/schwarz.
function chroma(hex) { const c = hexToRgb(hex); if (!c) return 0; return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b); }
// Helligkeit 0..1 (HSL-Lightness).
function lightness(hex) { const c = hexToRgb(hex); if (!c) return 1; return (Math.max(c.r, c.g, c.b) + Math.min(c.r, c.g, c.b)) / 2 / 255; }

// WCAG-Relativluminanz + Kontrastverhältnis.
function relLum(hex) {
  const c = hexToRgb(hex); if (!c) return 0;
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
export function contrastRatio(a, b) {
  const la = relLum(a), lb = relLum(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// Textfarbe auf einer Füll-/Plattenfarbe: die mit dem höheren Kontrast (≥4.5 angestrebt).
const INK_DARK = '#0a0a0a';
const INK_WHITE = '#ffffff';
export function pickInk(bgHex) {
  return contrastRatio(bgHex, INK_WHITE) >= contrastRatio(bgHex, INK_DARK) ? INK_WHITE : INK_DARK;
}

/**
 * Wählt die CI-FÜLLfarbe (für Platten, Balken, Headline-Boxen, Pills) EXAKT aus
 * farben = { primaer, sekundaer, akzent }. Bevorzugt primär; ist primär aber zu blass
 * für eine Fläche (sehr hell ODER zu wenig Buntheit — z. B. K&S #f0b8b8 Rosa), wird die
 * kräftigste CI-Farbe genommen (K&S → #e00010 Rot). Alle Werte bleiben exakte Hexwerte.
 */
export function pickFillColor(farben, fallback = '#e2001a') {
  const cands = [farben?.primaer, farben?.sekundaer, farben?.akzent].filter(isHex);
  if (!cands.length) return fallback;
  const p = isHex(farben?.primaer) ? farben.primaer : null;
  const zuBlass = c => lightness(c) > 0.80 || chroma(c) < 40;
  if (p && !zuBlass(p)) return p;
  // Kräftigste: höchste Buntheit, bei Gleichstand die dunklere (bessere Flächenwirkung).
  return cands.slice().sort((a, b) => chroma(b) - chroma(a) || lightness(a) - lightness(b))[0];
}

// Komplett aufgelöste CI-Rollen für einen Renderer.
export function ciRollen(farben, fallback = '#e2001a') {
  const fill = pickFillColor(farben, fallback);
  return {
    fill,                       // exakte CI-Füllfarbe (Platten/Balken/Headline/Pill)
    ink: pickInk(fill),         // kontrastsichere Textfarbe auf der Füllfarbe
    primaer: isHex(farben?.primaer) ? farben.primaer : fill,
    sekundaer: isHex(farben?.sekundaer) ? farben.sekundaer : fill,
    akzent: isHex(farben?.akzent) ? farben.akzent : fill,
  };
}

/* ───────────────────── Regel 1: dezente Foto-Dimmung ───────────────────── */

/**
 * Mittlere Helligkeit des Fotos messen und daraus die GLOBALE Dimm-Deckung ableiten.
 * Nur sehr helle Fotos werden leicht abgedunkelt, maximal 10 %. Dunkle/normale Fotos
 * bleiben unangetastet (Himmel, Gesicht, Belichtung wie im Original).
 * @returns {Promise<number>} Alpha 0..0.10 für ein schwarzes Vollflächen-Overlay.
 */
export async function fotoDimAlpha(buffer) {
  try {
    const { data } = await sharp(buffer).resize(64, 64, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let sum = 0, n = 0;
    for (let i = 0; i < data.length; i += 3) { sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]; n++; }
    const mean = n ? sum / n : 128;
    if (mean <= 190) return 0;                    // nur „sehr hell" bekommt überhaupt Dimmung
    return Math.min(0.10, ((mean - 190) / (255 - 190)) * 0.10);
  } catch { return 0; }
}

// Vollflächen-Dimm-Layer (≤10 %) als absolut positioniertes <div>. z unter dem Text.
export function dimLayerHtml(alpha, z = 1) {
  if (!(alpha > 0)) return '';
  return `<div style="position:absolute;inset:0;background:rgba(0,0,0,${alpha.toFixed(3)});z-index:${z};"></div>`;
}

/* ─────────────── Regel 2: lokale Lesbarkeit (Verlauf ODER Platte) ─────────────── */

// Weicher Verlauf NUR über der oberen Textzone: dunkel → transparent über die oberen 35 %.
export function topScrimHtml(strength = 0.55, z = 1) {
  return `<div style="position:absolute;left:0;right:0;top:0;height:35%;
    background:linear-gradient(to bottom, rgba(0,0,0,${strength}) 0%, rgba(0,0,0,0) 100%);z-index:${z};"></div>`;
}
// Weicher Verlauf NUR über der unteren Textzone: transparent → dunkel über die unteren 25 %.
export function bottomScrimHtml(strength = 0.72, z = 1) {
  return `<div style="position:absolute;left:0;right:0;bottom:0;height:25%;
    background:linear-gradient(to top, rgba(0,0,0,${strength}) 0%, rgba(0,0,0,0) 100%);z-index:${z};"></div>`;
}

// Textplatte (Alternative zum Verlauf): CI-Füllfarbe oder Weiß, 92 % Deckung, abgerundet.
// Rückgabe: CSS-String für den Block-Container (als inline-block einsetzen).
export function plateCss(bgHex, { radius = 18, padX = 30, padY = 18 } = {}) {
  return `display:inline-block;background:${rgba(bgHex, 0.92)};border-radius:${radius}px;padding:${padY}px ${padX}px;`;
}

/* ─────────────── Regel 3: Logo-Grund (HTML-Renderer) ─────────────── */

// Weiße Logo-Platte: 16px Innenabstand, 12px Radius, (nahezu) deckend.
// Für helle/weiße Logos wird der Grund CI-farben, damit das Logo sichtbar bleibt.
export function logoPlateCss(ground = '#ffffff') {
  return `display:inline-flex;align-items:center;justify-content:center;background:${ground};
    padding:16px;border-radius:12px;box-shadow:0 6px 20px rgba(0,0,0,0.18);`;
}

/* ─────────────── Regel 5: Typografie ─────────────── */

// Dezenter Schatten für die Stellenbezeichnung in Weiß — KEIN Glow, kein Farbschein.
export const TITLE_SHADOW = '0 2px 8px rgba(0,0,0,0.45)';

/* ───────────────────────── Hilfen ───────────────────────── */

// data:-URI → Buffer (oder null). Für Mess-Schritte (Foto-Dimmung, Logo-Grund).
export function dataUriToBuffer(uri) {
  const m = /^data:[^;,]*;base64,(.*)$/s.exec(String(uri || ''));
  if (!m) return null;
  try { return Buffer.from(m[1], 'base64'); } catch { return null; }
}

// Ist das Logo praktisch weiß (würde es auf weißer Platte verschwinden)? NUR dann
// braucht es einen dunklen / CI-farbenen Grund. Gemessen am Anteil sichtbarer Pixel,
// die dunkel genug sind, um auf Weiß lesbar zu sein — robust gegen bunte, aber gut
// sichtbare Logos (z. B. gelbe Sonne + blaue Schrift), die ein reiner Helligkeits-
// Mittelwert fälschlich als „hell" einstuft und dann mit schwarzer Platte hinterlegt.
export async function logoIstHell(logoBuffer) {
  if (!logoBuffer) return false;
  try {
    const { data } = await sharp(logoBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    // Nur die entschiedenen Pixel zählen: klar helle (würden auf Weiß verschwinden)
    // vs. klar dunkle (auf Weiß gut lesbar). Mittelgraue Anti-Aliasing-Ränder werden
    // ignoriert, sonst stuft ein dunkler Kantensaum ein weißes Logo falsch ein.
    let vis = 0, hell = 0, dunkel = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 32) continue;
      vis++;
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (lum > 215) hell++;
      else if (lum < 140) dunkel++;
    }
    if (!vis) return false;
    // Weißes Logo: helle Pixel dominieren UND fast keine klar dunklen Pixel vorhanden.
    return (hell / vis) > 0.5 && (dunkel / vis) < 0.08;
  } catch { return false; }
}

// Logo-Grund (Regel 3): normale (dunkle oder bunte) Logos → weiße Platte;
// nur praktisch weiße Logos → CI-Füllfarbe, damit das Logo sichtbar bleibt.
export async function logoGround(logoBuffer, fillHex) {
  if (!logoBuffer) return '#ffffff';
  return (await logoIstHell(logoBuffer)) ? (fillHex || '#0a0a0a') : '#ffffff';
}
