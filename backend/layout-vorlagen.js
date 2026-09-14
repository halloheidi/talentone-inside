// Deterministische Layout-Vorlagen (Sharp-/Puppeteer-Rendering, KEINE KI-Freiheiten).
//
// Anders als der freie Modus (gpt-image-2, mischt Stilvorlagen nur als Inspiration)
// baut dieser Modus zwei fest definierte Kompositionen exakt nach Referenz nach.
// Alle Inhalte kommen AUSSCHLIESSLICH aus den gewählten Daten (Spruch-Feld,
// Stammdaten, transparentes Logo, gewähltes Foto). Nichts wird ergänzt —
// keine Benefits, keine Icons, keine Zusatztexte.
//
// Gerendert wird als HTML → Puppeteer-Screenshot (wie overlay-renderer.js), weil
// Glow, Pills, mehrzeilige Versal-Blöcke und auto-skalierende Schrift in CSS
// deterministisch und pixelstabil sind.

import { uploadBuffer } from './storage.js';
import { STORAGE_BUCKET } from './imagegen.js';
import { callClaudeWithRetry, parseJsonContent } from './claude.js';
import { randomUUID } from 'node:crypto';

const CLAUDE_MODEL = 'claude-sonnet-4-6';

const FORMAT_DIMS = {
  quadrat: { w: 1080, h: 1080 },
  story:   { w: 1080, h: 1920 },
};

// Meta-Safe-Zone bei 9:16 (1080×1920): oben ~250px, unten ~340px sind reserviert.
// Bei 'story' werden die Elemente in diese sichere Zone gerückt (gleiche Logik
// wie beim Story-Logo im freien Modus).
const SAFE = { story: { top: 260, bottom: 340 }, quadrat: { top: 48, bottom: 48 } };

export const LAYOUT_VORLAGEN = [
  {
    id: 'A',
    name: 'Frage + Glow-Headline + Team',
    beschreibung: 'Dunkler Foto-Hintergrund, Hook-Frage auf Marken-Balken, Stellentitel riesig mit Neon-Glow, Pill-Badge, freigestellte Person unten, Logo unten mittig.',
  },
  {
    id: 'B',
    name: 'Person links + Textblock rechts',
    beschreibung: 'Logo oben mittig, freigestellte Person links, rechts rechtsbündiger Versal-Textblock (ein Wort in Markenfarbe kursiv), Stellentitel unten mit Glow + Pill-Badge.',
  },
];

export function istLayoutVorlage(id) {
  return LAYOUT_VORLAGEN.some(v => v.id === id);
}

// ── Ort aus der Region säubern (Umkreis/+30km/Klammern weg) ──
function cleanOrt(region) {
  if (!region) return '';
  return String(region)
    .split(/[,(]|\+|\bumkreis\b|\bumgebung\b/i)[0]
    .replace(/\d+\s*km/gi, '')
    .trim();
}

function arbeitszeit(job) {
  const fd = job?.formdata_komplett || {};
  return fd.anstellungsart || fd.arbeitszeit || job?.anstellungsart || 'Vollzeit';
}

/**
 * Standard-Slot-Werte aus den gewählten Daten. `spruch` ist der im Spruch-Feld
 * gewählte Text (unverändert). Alle Werte sind frei editierbar im Dialog.
 */
export function buildSlotDefaults({ vorlage, job, kunde, spruch }) {
  const ort = cleanOrt(job?.region);
  const stelle = job?.stelle || '';
  const az = arbeitszeit(job);
  if (vorlage === 'B') {
    return {
      textblock: (spruch || '').trim(),      // *Wort* = Hervorhebung
      stelle,
      ort,
      pill: `(m/w/d) in ${ort || '[Ort]'} gesucht!`,
    };
  }
  // Vorlage A
  return {
    hook: (spruch || '').trim(),
    stelle,
    ort,
    pill: [ort, az, 'm/w/d'].filter(Boolean).join('  I  '),
  };
}

/**
 * Warn-only-Lektorat: prüft die Slot-Texte auf Rechtschreibung/Tippfehler,
 * ändert aber NIE den Wortlaut. Gibt bei Befund einen Warnhinweis zurück.
 * @returns {Promise<Array<{ slot:string, hinweis:string, vorschlag?:string }>>}
 */
export async function pruefeSlotTexteWarnung(slots, ctx = {}) {
  const felder = [];
  for (const [slot, val] of Object.entries(slots || {})) {
    const t = String(val || '').replace(/\*/g, '').trim();
    if (t && slot !== 'pill') felder.push({ slot, text: t });
  }
  if (!felder.length) return [];

  const stammdaten = [
    ctx.stelle ? `Stelle: "${ctx.stelle}"` : '',
    ctx.region ? `Region: "${ctx.region}"` : '',
  ].filter(Boolean).join(' · ');

  const prompt = `Du bist ein deutscher Korrektor. Prüfe die folgenden Werbe-Textbausteine NUR auf Rechtschreib- und Tippfehler sowie klar falsche Grammatik.

WICHTIG: Ändere NIEMALS den Wortlaut, den Stil oder die Aussage. Du korrigierst nichts eigenmächtig — du MELDEST nur mögliche Fehler. VERSALIEN und absichtliche Umbrüche sind kein Fehler.

STAMMDATEN (maßgebliche Schreibweise): ${stammdaten || '—'}

BAUSTEINE:
${felder.map((f, i) => `${i + 1}. [${f.slot}] "${f.text}"`).join('\n')}

Antworte NUR mit JSON (keine Markdown-Backticks). Nur Bausteine MIT Befund auflisten, fehlerfreie weglassen:
{ "befunde": [ { "nr": 1, "hinweis": "kurzer Hinweis, was auffällt", "vorschlag": "korrigierte Fassung (optional)" } ] }`;

  try {
    const data = await callClaudeWithRetry({ model: CLAUDE_MODEL, max_tokens: 600, messages: [{ role: 'user', content: prompt }] });
    const parsed = parseJsonContent(data);
    const befunde = Array.isArray(parsed?.befunde) ? parsed.befunde : [];
    return befunde.map(b => {
      const f = felder[(b.nr || 0) - 1];
      return f ? { slot: f.slot, hinweis: String(b.hinweis || '').trim(), vorschlag: b.vorschlag ? String(b.vorschlag).trim() : undefined } : null;
    }).filter(b => b && b.hinweis);
  } catch {
    return []; // Lektorat ausgefallen → keine Warnung, kein Blocker
  }
}

/* ─────────────────────────── HTML-Bau ─────────────────────────── */

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

// Zeilenumbrüche im Slot-Text zu <br> — der gewählte Text bleibt exakt erhalten.
function nl2br(s) {
  return escapeHtml(s).replace(/\n/g, '<br>');
}

// *Wort* → hervorgehobenes (Markenfarbe, kursiv) Wort. Rest escaped.
function highlightMarkup(s, accent) {
  const esc = escapeHtml(s);
  return esc.replace(/\*([^*]+)\*/g, (_, w) => `<em class="hl" style="color:${accent}">${w}</em>`)
    .replace(/\n/g, '<br>');
}

function dim(hex, alpha) {
  const h = String(hex || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(h)) return `rgba(226,0,26,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function pickInk(hex) {
  const h = String(hex || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(h)) return '#ffffff';
  const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.6 ? '#0a0a0a' : '#ffffff';
}

const FONT_STACK = `"Liberation Sans","DejaVu Sans","Segoe UI",Roboto,Arial,sans-serif`;

// Gemeinsamer <head> + Glow-Definition.
function head(accent) {
  return `<meta charset="utf-8"><style>
    * { margin:0; padding:0; box-sizing:border-box; font-family:${FONT_STACK}; }
    .glow-accent { text-shadow: 0 0 10px ${accent}, 0 0 26px ${accent}, 0 0 54px ${dim(accent, 0.7)}; }
    .glow-white  { text-shadow: 0 0 8px rgba(255,255,255,0.55), 0 0 24px ${dim(accent, 0.65)}, 0 0 48px ${dim(accent, 0.5)}; }
    .pill { display:inline-block; border:3px solid rgba(255,255,255,0.9); border-radius:100px;
            font-weight:800; letter-spacing:0.04em; text-transform:uppercase; color:#fff; white-space:nowrap; }
  </style>`;
}

// Vorlage A — Frage + Glow-Headline + Team unten.
function htmlVorlageA({ dims, accent, ink, slots, fotoUri, cutoutUri, logoUri, safe }) {
  const hookLines = String(slots.hook || '').split('\n').filter(l => l.trim().length);
  const bars = hookLines.map((line, i) => `
    <div style="align-self:flex-start; max-width:88%; background:${accent}; color:${ink};
      padding:14px 26px; border-radius:12px; font-weight:800; font-size:52px; line-height:1.12;
      text-transform:none; margin-left:${i * 34}px; box-shadow:0 10px 30px rgba(0,0,0,0.35);">${nl2br(line)}</div>`).join('<div style="height:12px"></div>');

  return `<!doctype html><html><head>${head(accent)}</head>
  <body style="width:${dims.w}px;height:${dims.h}px;position:relative;overflow:hidden;background:#000;">
    <!-- Foto-Hintergrund, stark abgedunkelt + Vignette -->
    <img src="${fotoUri}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;">
    <div style="position:absolute;inset:0;background:
      radial-gradient(120% 90% at 50% 30%, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.78) 100%),
      linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.15) 42%, rgba(0,0,0,0.85) 100%);"></div>

    <!-- freigestellte Person: untere Bildhälfte -->
    ${cutoutUri ? `<img src="${cutoutUri}" style="position:absolute;left:50%;bottom:${Math.round(safe.bottom * 0.42)}px;transform:translateX(-50%);height:52%;max-width:96%;object-fit:contain;object-position:bottom;filter:drop-shadow(0 12px 30px rgba(0,0,0,0.6));">` : ''}

    <!-- Text-Ebene -->
    <div style="position:absolute;left:60px;right:60px;top:${safe.top}px;display:flex;flex-direction:column;gap:0;z-index:3;">
      ${bars}
      <div style="height:26px"></div>
      <div data-autofit data-max="150" data-min="60"
        style="width:100%;font-weight:900;font-size:150px;line-height:0.98;letter-spacing:-0.02em;
        text-transform:uppercase;color:${accent};" class="glow-accent">${escapeHtml(slots.stelle || '')}</div>
      <div style="height:24px"></div>
      ${slots.pill ? `<div><span class="pill" style="font-size:30px;padding:12px 30px;">${escapeHtml(slots.pill)}</span></div>` : ''}
    </div>

    <!-- Logo unten mittig -->
    ${logoUri ? `<img src="${logoUri}" style="position:absolute;left:50%;bottom:${Math.round(safe.bottom * 0.55)}px;transform:translateX(-50%);max-width:34%;max-height:${Math.round(dims.h * 0.09)}px;object-fit:contain;z-index:4;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.5));">` : ''}
  </body></html>`;
}

// Vorlage B — Person links + Textblock rechts.
function htmlVorlageB({ dims, accent, slots, fotoUri, cutoutUri, logoUri, safe }) {
  const hasCut = !!cutoutUri;
  // Mit Freisteller: dunkler Marken-Verlauf als Grund + Person links.
  // Ohne Freisteller: Foto als abgedunkelter Vollhintergrund, Textlayout identisch.
  const bg = hasCut
    ? `<div style="position:absolute;inset:0;background:
         radial-gradient(90% 80% at 20% 60%, ${dim(accent, 0.28)} 0%, rgba(10,10,12,0.96) 60%), #0a0a0c;"></div>`
    : `<img src="${fotoUri}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;">
       <div style="position:absolute;inset:0;background:linear-gradient(to right, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.82) 62%);"></div>`;

  return `<!doctype html><html><head>${head(accent)}</head>
  <body style="width:${dims.w}px;height:${dims.h}px;position:relative;overflow:hidden;background:#0a0a0c;">
    ${bg}

    <!-- Logo oben mittig -->
    ${logoUri ? `<img src="${logoUri}" style="position:absolute;left:50%;top:${safe.top}px;transform:translateX(-50%);max-width:32%;max-height:${Math.round(dims.h * 0.08)}px;object-fit:contain;z-index:5;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.5));">` : ''}

    <!-- Person links (untere zwei Drittel) -->
    ${hasCut ? `<img src="${cutoutUri}" style="position:absolute;left:0;bottom:${Math.round(safe.bottom * 0.5)}px;height:64%;max-width:56%;object-fit:contain;object-position:left bottom;filter:drop-shadow(0 12px 30px rgba(0,0,0,0.6));z-index:2;">` : ''}

    <!-- Rechter Textblock: rechtsbündig, Versalien -->
    <div style="position:absolute;right:56px;top:${safe.top + Math.round(dims.h * 0.14)}px;${hasCut ? 'left:48%;' : 'left:40%;'}text-align:right;z-index:4;">
      <div data-autofit data-max="76" data-min="34"
        style="width:100%;font-weight:900;font-size:76px;line-height:1.06;letter-spacing:-0.01em;
        text-transform:uppercase;color:#fff;">${highlightMarkup(slots.textblock || '', accent)}</div>
    </div>

    <!-- Stellentitel unten mit Glow + Pill -->
    <div style="position:absolute;left:56px;right:56px;bottom:${safe.bottom}px;text-align:center;z-index:4;">
      <div data-autofit data-max="120" data-min="52"
        style="width:100%;font-weight:900;font-size:120px;line-height:0.98;letter-spacing:-0.02em;
        text-transform:uppercase;color:#fff;" class="glow-white">${escapeHtml(slots.stelle || '')}</div>
      <div style="height:22px"></div>
      ${slots.pill ? `<div><span class="pill" style="font-size:30px;padding:12px 30px;border-color:${accent};">${escapeHtml(slots.pill)}</span></div>` : ''}
    </div>
  </body></html>`;
}

// Auto-Skalierung im Browser: Schrift verkleinern bis Text in seine Box passt.
function autofitScript() {
  document.querySelectorAll('[data-autofit]').forEach(el => {
    const max = parseFloat(el.getAttribute('data-max')) || 120;
    const min = parseFloat(el.getAttribute('data-min')) || 30;
    let size = max;
    el.style.fontSize = size + 'px';
    // parent-Box als Höhen-Limit
    const parent = el.parentElement;
    const maxH = parent ? parent.getBoundingClientRect().height : el.getBoundingClientRect().height;
    let guard = 0;
    while (size > min && guard < 200) {
      const overflowW = el.scrollWidth > el.clientWidth + 1;
      const overflowH = el.getBoundingClientRect().height > maxH + 1;
      if (!overflowW && !overflowH) break;
      size -= 2; el.style.fontSize = size + 'px';
      guard++;
    }
  });
}

/**
 * Rendert EIN Format einer Vorlage → PNG-Buffer.
 */
async function renderOne(browser, { vorlage, format, accent, ink, slots, fotoUri, cutoutUri, logoUri }) {
  const dims = FORMAT_DIMS[format];
  if (!dims) throw new Error(`Unbekanntes Format: ${format}`);
  const safe = SAFE[format] || SAFE.quadrat;

  const html = vorlage === 'B'
    ? htmlVorlageB({ dims, accent, slots, fotoUri, cutoutUri, logoUri, safe })
    : htmlVorlageA({ dims, accent, ink, slots, fotoUri, cutoutUri, logoUri, safe });

  const page = await browser.newPage();
  await page.setViewport({ width: dims.w, height: dims.h, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'networkidle0' });
  // Alle (data-URI-)Bilder wirklich dekodiert, bevor Auto-Fit misst.
  await page.evaluate(() => Promise.all(
    Array.from(document.images).map(img => (img.complete && img.naturalWidth)
      ? Promise.resolve()
      : new Promise(r => { img.onload = img.onerror = () => r(); }))
  ));
  await page.evaluate(autofitScript);
  const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: dims.w, height: dims.h } });
  await page.close();
  return Buffer.from(png);
}

/**
 * Rendert die Vorlage in den angeforderten Formaten und lädt die PNGs hoch.
 *
 * @param {object} p
 * @param {'A'|'B'} p.vorlage
 * @param {object} p.job, p.kunde
 * @param {string} p.fotoUri     data:-URI des gewählten Fotos (Pflicht)
 * @param {string|null} p.cutoutUri  data:-URI des Freistellers (oder null → Fallback)
 * @param {string|null} p.logoUri    data:-URI des transparenten Logos (oder null)
 * @param {object} p.slots
 * @param {string[]} p.formats   z.B. ['quadrat'] oder ['quadrat','story']
 * @param {string} p.jobId
 * @returns {Promise<Array<{ format, bild_url }>>}
 */
export async function renderLayoutVorlage({ vorlage, kunde, fotoUri, cutoutUri, logoUri, slots, formats = ['quadrat'], jobId }) {
  const accent = kunde?.farben?.primaer || kunde?.farben?.akzent || '#e2001a';
  const ink = pickInk(accent);

  const puppeteer = (await import('puppeteer')).default;
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const out = [];
    for (const format of formats) {
      const buffer = await renderOne(browser, { vorlage, format, accent, ink, slots, fotoUri, cutoutUri, logoUri });
      const key = `layout/${jobId}/${randomUUID()}_${vorlage}_${format}.png`;
      const url = await uploadBuffer({ bucket: STORAGE_BUCKET, path: key, buffer, contentType: 'image/png' });
      out.push({ format, bild_url: url });
    }
    return out;
  } finally {
    await browser.close();
  }
}
