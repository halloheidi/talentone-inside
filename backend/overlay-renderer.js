// Overlay-Renderer: baut ein HTML-Template und rendert es via Puppeteer
// als transparentes PNG. Wird von /api/creatives/generate mit mode='overlay'
// aufgerufen. Kein OpenAI, kein KI-Bild — nur Text-Elemente auf transparentem
// Grund, die in Canva/o.ä. über ein echtes Foto gelegt werden.

import { uploadBuffer } from './storage.js';
import { STORAGE_BUCKET } from './imagegen.js';
import { randomUUID } from 'node:crypto';

const FORMAT_DIMS = {
  '1:1':  { w: 1080, h: 1080 },
  '9:16': { w: 1080, h: 1920 },
};

/**
 * Fetch das Logo und konvertiert es zu data:-URL, damit Puppeteer es
 * ohne Netz-Request rendert (Isolation + Speed).
 */
async function logoAsDataUri(logoUrl) {
  if (!logoUrl) return null;
  try {
    const res = await fetch(logoUrl);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get('content-type') || 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch { return null; }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

/**
 * Baut das HTML-Overlay-Template. Der Body ist transparent (kein bg-color).
 * Auf der oberen Bild-Zone sitzt der Hook-Banner, unten der Job-Block.
 *
 * ctx = {
 *   format:   '1:1' | '9:16',
 *   width, height,
 *   primary:  Marken-Primärfarbe (Hintergrund Job-Block, Banner, CTA)
 *   ink:      Textfarbe auf primary
 *   hook:     Spruch/Hook (max ~60 Zeichen sinnvoll)
 *   stelle:   Stellenbezeichnung
 *   ort:      Ort (optional)
 *   arbeitszeit: 'Vollzeit' o.ä. (optional)
 *   diversitat:  'm/w/d' (optional)
 *   benefits: [Text, ...] max ~4
 *   logoDataUri: data:image/... — oder null
 * }
 */
function buildOverlayHtml(ctx) {
  const { width, height, primary, ink, hook, stelle, ort, arbeitszeit, diversitat, benefits, logoDataUri } = ctx;
  const isPortrait = height > width;

  // Feinjustierung fuer 9:16 (grosszuegiger Job-Block, kleinerer Banner)
  const bannerFontSize = isPortrait ? 62 : 54;
  const stelleFontSize = isPortrait ? 74 : 62;
  const benefitFontSize = isPortrait ? 30 : 26;
  const metaFontSize = isPortrait ? 28 : 24;
  const jobBlockHeight = isPortrait ? '38%' : '40%';
  const gradientHeight = 140; // sanfter Uebergang ueber dem Job-Block

  const metaParts = [
    ort && `📍 ${ort}`,
    arbeitszeit || null,
    diversitat || 'm/w/d',
  ].filter(Boolean);

  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .stage {
    position: relative;
    width: ${width}px;
    height: ${height}px;
    background: transparent;
  }
  /* Hook-Banner oben */
  .hook-banner {
    position: absolute;
    top: 60px;
    left: 60px;
    right: 60px;
    padding: 28px 36px;
    background: ${primary};
    color: ${ink};
    font-weight: 900;
    font-size: ${bannerFontSize}px;
    line-height: 1.1;
    letter-spacing: -0.01em;
    border-radius: 18px;
    text-align: center;
    box-shadow: 0 12px 40px rgba(0,0,0,0.18);
    text-transform: uppercase;
  }
  /* Logo oben rechts */
  .logo {
    position: absolute;
    top: 60px;
    right: 60px;
    max-height: 96px;
    max-width: 220px;
    background: #fff;
    padding: 10px 14px;
    border-radius: 12px;
    box-shadow: 0 6px 20px rgba(0,0,0,0.15);
    object-fit: contain;
    z-index: 5;
  }
  /* Gradient von transparent -> primary am Übergang zum Job-Block */
  .fade {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(${jobBlockHeight});
    height: ${gradientHeight}px;
    background: linear-gradient(to bottom, transparent 0%, ${primary} 100%);
    z-index: 1;
  }
  /* Job-Block unten */
  .job-block {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: ${jobBlockHeight};
    background: ${primary};
    color: ${ink};
    padding: ${isPortrait ? 60 : 48}px 60px ${isPortrait ? 70 : 56}px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    z-index: 2;
  }
  .stelle {
    font-size: ${stelleFontSize}px;
    font-weight: 900;
    line-height: 1.05;
    letter-spacing: -0.02em;
    margin: 0 0 14px;
    text-transform: uppercase;
  }
  .meta-row {
    display: flex;
    flex-wrap: wrap;
    gap: 18px;
    font-size: ${metaFontSize}px;
    font-weight: 600;
    opacity: 0.9;
    margin-bottom: ${isPortrait ? 22 : 18}px;
  }
  .benefits {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: ${isPortrait ? 26 : 22}px;
  }
  .benefit {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: ${benefitFontSize}px;
    font-weight: 600;
    line-height: 1.2;
  }
  .benefit .dot {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: ${benefitFontSize + 12}px;
    height: ${benefitFontSize + 12}px;
    border-radius: 50%;
    background: ${ink};
    color: ${primary};
    font-weight: 900;
    font-size: ${Math.round(benefitFontSize * 0.85)}px;
    flex-shrink: 0;
  }
  .cta {
    align-self: flex-start;
    padding: ${isPortrait ? '20px 44px' : '18px 40px'};
    background: ${ink};
    color: ${primary};
    font-weight: 800;
    font-size: ${isPortrait ? 32 : 28}px;
    border-radius: 100px;
    letter-spacing: 0.02em;
  }
</style>
</head><body>
  <div class="stage">
    ${hook ? `<div class="hook-banner">${escapeHtml(hook)}</div>` : ''}
    ${logoDataUri ? `<img class="logo" src="${logoDataUri}" alt="">` : ''}
    <div class="fade"></div>
    <div class="job-block">
      <div>
        <h1 class="stelle">${escapeHtml(stelle || '')}</h1>
        <div class="meta-row">
          ${metaParts.map(m => `<span>${escapeHtml(m)}</span>`).join('')}
        </div>
        <div class="benefits">
          ${(benefits || []).slice(0, 4).map(b => `
            <div class="benefit"><span class="dot">✓</span>${escapeHtml(b)}</div>
          `).join('')}
        </div>
      </div>
      <div class="cta">→ Jetzt bewerben</div>
    </div>
  </div>
</body></html>`;
}

/**
 * Rendert EIN Overlay-PNG (transparent) fuer ein Format und lädt es in
 * Supabase Storage hoch. Rückgabe: public URL.
 */
async function renderOne(browser, ctx, jobId) {
  const dims = FORMAT_DIMS[ctx.format];
  if (!dims) throw new Error(`Unbekanntes Format: ${ctx.format}`);

  const html = buildOverlayHtml({ ...ctx, width: dims.w, height: dims.h });
  const page = await browser.newPage();
  await page.setViewport({ width: dims.w, height: dims.h, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'domcontentloaded' });

  // Wichtig: omitBackground=true fuer echte Transparenz. Der Body ist zusaetzlich transparent.
  const png = await page.screenshot({
    type: 'png',
    omitBackground: true,
    clip: { x: 0, y: 0, width: dims.w, height: dims.h },
  });
  await page.close();

  const key = `overlay/${jobId}/${randomUUID()}_${ctx.format.replace(':', 'x')}.png`;
  const url = await uploadBuffer({
    bucket: STORAGE_BUCKET,
    path: key,
    buffer: Buffer.from(png),
    contentType: 'image/png',
  });
  return { url };
}

/**
 * Erzeugt Overlays fuer alle angeforderten Formate. Puppeteer wird einmal
 * gestartet und für alle Overlays wiederverwendet.
 *
 * input = {
 *   job, kunde, spruch, benefits?, formats=['1:1','9:16']
 * }
 * return: [{ format, bild_url }]
 */
export async function generateOverlays({ job, kunde, spruch, benefits, formats = ['1:1', '9:16'] } = {}) {
  const puppeteer = (await import('puppeteer')).default;
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const logoDataUri = await logoAsDataUri(kunde?.logo_url);
    const primary = kunde?.farben?.primaer || '#0a0a0a';
    const ink = pickTextInk(primary);

    const stelle = job?.stelle || 'Neue Stelle';
    const fd = job?.formdata_komplett || {};
    const ort = job?.region || fd?.region || fd?.standort || null;
    const arbeitszeit = fd?.arbeitszeit || fd?.beschaeftigungsart || 'Vollzeit';
    const useBenefits = Array.isArray(benefits) && benefits.length
      ? benefits
      : (Array.isArray(job?.benefits) ? job.benefits.filter(Boolean).slice(0, 4) : []);

    const ctxBase = {
      primary, ink, logoDataUri,
      hook: (spruch || '').trim(),
      stelle,
      ort,
      arbeitszeit,
      diversitat: 'm/w/d',
      benefits: useBenefits,
    };

    const results = [];
    for (const format of formats) {
      const r = await renderOne(browser, { ...ctxBase, format }, job.id);
      results.push({ format, bild_url: r.url });
    }
    return results;
  } finally {
    await browser.close();
  }
}

/**
 * Kleine Helferin: bestimmt Textfarbe (ink) auf einem Marken-Primary.
 * Hell auf Dunkel, Dunkel auf Hell — grober Luminanz-Test.
 */
function pickTextInk(primaryHex) {
  const hex = String(primaryHex || '#000').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return '#ffffff';
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.6 ? '#0a0a0a' : '#ffffff';
}
