// Funnel-Helpers: Fragen-Vorschläge via Claude + Stimmungsbild via gpt-image-1.

import sharp from 'sharp';
import { callClaudeWithRetry, parseJsonContent } from './claude.js';
import { uploadBuffer, fetchAsBuffer } from './storage.js';

const CLAUDE_MODEL = 'claude-sonnet-4-6';
const OPENAI_IMAGES_API = 'https://api.openai.com/v1/images/generations';
export const FUNNEL_BUCKET = 'talentone-funnel-bilder';

const BRANCHE_LABEL = {
  handwerk: 'Handwerk & Bau', pflege: 'Pflege & Soziales',
  einzelhandel: 'Einzelhandel', gastro: 'Gastronomie & Hotel',
  buero: 'Büro & Verwaltung', logistik: 'Logistik & Transport',
};

/* ───────────────────── Fragen vorschlagen ───────────────────── */

// 3 garantierte Basisfragen — werden IMMER zuerst vorgeschlagen, selbst wenn die KI ausfällt.
function buildStandardFragen(job) {
  const rawStelle = (job?.stelle || 'dieser Stelle').trim();
  const stelleClean = rawStelle.replace(/\s*\([mwfd][\/\\mwfd\s\-]+\)\s*$/i, '').trim();
  return [
    {
      text: `Hast du eine Ausbildung als ${stelleClean}?`,
      options: [
        { text: 'Ja, abgeschlossen' },
        { text: 'In Ausbildung' },
        { text: 'Nein, aber Erfahrung' },
        { text: 'Weder noch' },
      ],
    },
    {
      text: 'Hast du einen Führerschein Klasse B?',
      options: [
        { text: 'Ja' },
        { text: 'Nein' },
      ],
    },
    {
      text: 'Was beschreibt dich am besten?',
      options: [
        { text: 'Teamfähigkeit' },
        { text: 'Eigeninitiative' },
        { text: 'Zuverlässigkeit' },
        { text: 'Belastbarkeit' },
      ],
    },
  ];
}

export async function generateFragenVorschlaege(job, kunde) {
  const standard = buildStandardFragen(job);

  // Branchenspezifische Zusatzfragen via Claude (best-effort)
  const fd = job.formdata_komplett || {};
  const branche = BRANCHE_LABEL[kunde?.branche] || kunde?.branche || '';
  const kontext = `Stelle: ${job.stelle || '-'}
Branche: ${branche}
Region: ${job.region || '-'}
Geforderte Ausbildung: ${fd.ausbildung || '-'}
Quereinsteiger willkommen: ${job.quereinsteiger ? 'ja' : 'nein'}
Reisebereitschaft erforderlich: ${job.reisebereitschaft ? 'ja' : 'nein'}`;

  const prompt = `Du bist Recruiting-Funnel-Experte. Wir haben bereits 3 Basisfragen abgedeckt: Ausbildung/Qualifikation, Führerschein Klasse B, Soft Skills. Schlage 1-3 ZUSÄTZLICHE branchenspezifische Multiple-Choice-Fragen vor — KEINE Doppelungen zu diesen 3 Themen.

${kontext}

Branchenspezifisch sinnvoll:
- Handwerk: weitere Führerschein-Klassen, Berufserfahrung in Jahren, Spezialisierung
- Pflege: Examiniert, Schichtbereitschaft, Wochenendarbeit
- Logistik: weitere Führerschein-Klassen, Schichtbereitschaft
- Allgemein: Verfügbarkeit ab wann, konkrete Berufserfahrung in Jahren

Pro Frage:
- text: KURZ (max 10 Wörter), Du-Ansprache, freundlich
- options: 2-4 Antwort-Optionen, KURZ (1-3 Wörter)

Antworte NUR mit JSON, keine Markdown-Backticks:
{ "fragen": [{ "text": "...", "options": ["...", "..."] }] }`;

  let zusatz = [];
  try {
    const data = await callClaudeWithRetry({
      model: CLAUDE_MODEL,
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    });
    const parsed = parseJsonContent(data);
    const raw = Array.isArray(parsed.fragen) ? parsed.fragen : [];
    zusatz = raw.slice(0, 3).map(f => ({
      text: String(f.text || '').trim(),
      options: Array.isArray(f.options)
        ? f.options.map(o => ({ text: String(o).trim() })).filter(o => o.text).slice(0, 4)
        : [],
    })).filter(f => f.text && f.options.length >= 2);
  } catch (err) {
    console.warn('[fragen-vorschlaege] KI-Zusatz failed:', err.message);
  }

  return [...standard, ...zusatz];
}

/* ───────────────────── Initial-Screens (Texte) generieren ───────────────────── */

export async function generateInitialScreenTexts(job, kunde) {
  const fd = job.formdata_komplett || {};
  const branche = BRANCHE_LABEL[kunde?.branche] || kunde?.branche || '';
  const benefits = Array.isArray(job.benefits) ? job.benefits.filter(Boolean) : [];
  const fdBenefits = (fd.benefits_zusatz || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean);
  const allBenefits = [...new Set([...benefits, ...fdBenefits])];

  const briefing = `Stelle: ${job.stelle || '-'}
Firma: ${kunde?.firmenname || '-'}
Branche: ${branche}
Region: ${job.region || '-'}
Gehalt: ${job.gehalt || '-'}
Was unterscheidet das Unternehmen: ${fd.unterschied || '-'}
Warum arbeiten Mitarbeiter gerne hier: ${fd.mitarbeiter_gerne || '-'}
Unternehmenskultur: ${fd.unternehmenskultur || '-'}
Mitarbeiterzahl: ${fd.mitarbeiter_anzahl || '-'}
Benefits: ${allBenefits.join(', ') || '-'}
Besonderheiten der Stelle: ${job.besonderheiten || '-'}`;

  const prompt = `Du bist Recruiting-Funnel-Designer. Generiere die Texte für eine 3-Screen Funnel-Einleitung (Mobile-First Bewerbungsseite). Sprache: Deutsch, Du-Ansprache, locker, auf Augenhöhe — KEIN HR-Sprech.

BRIEFING:
${briefing}

OUTPUT: 3 Screen-Inhalte als JSON (KEINE Markdown-Backticks):

{
  "intro": {
    "headline": "",
    "body": "2-3 Sätze über das Unternehmen (warum besonders, was Mitarbeiter schätzen) — locker, kein Werbesprech",
    "teaser": "EXAKT die Formulierung 'Neugierig welche Vorteile dich als <Stellenname aus dem Briefing> bei uns erwarten?' verwenden — keine andere Formulierung, nur den Stellennamen einsetzen",
    "yes_button": "Ja klar! 🚀",
    "info_button": "Mehr Infos bitte ℹ️"
  },
  "benefits": {
    "headline": "Das erwartet dich bei uns",
    "body": "1-2 einleitende Sätze, kein Aufzählen — die Liste kommt darunter",
    "quote": "Optional: ein konkretes Highlight oder Mitarbeiter-Zitat-Stil (1 Satz, gerne mit Anführungszeichen). Wenn kein guter Inhalt, leer.",
    "next_button": "Und was sind meine Aufgaben? →"
  },
  "tasks": {
    "headline": "Deine Aufgaben als [Stelle]",
    "intro": "1 einleitender Satz vor der Aufgaben-Liste",
    "aufgaben": ["Konkrete Aufgabe 1, kurz", "Aufgabe 2", "Aufgabe 3", "Aufgabe 4", "Aufgabe 5"],
    "next_button": "Klingt gut — jetzt bewerben! →"
  }
}

Wichtig:
- Aufgaben-Liste 4-6 Punkte, jeweils 3-8 Wörter, konkret zur Stelle. Aus den Briefing-Infos ableiten.
- Texte konkret und auf Augenhöhe, keine Floskeln`;

  const data = await callClaudeWithRetry({
    model: CLAUDE_MODEL,
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  });
  const parsed = parseJsonContent(data);
  return parsed; // { intro, benefits, tasks }
}

/* ───────────────────── Stimmungsbild generieren ───────────────────── */

// Landscape ist Default — Funnel-Screens brauchen 16:9-Bilder. gpt-image-1 unterstützt
// 1536x1024 (3:2), das spätere Crop-Tool schneidet daraus exakt 16:9 zu.
const SIZE_MAP = {
  square: '1024x1024',
  portrait: '1024x1536',
  landscape: '1536x1024',
};

export async function generateFunnelImage({ job, kunde, customPrompt, format = 'landscape' }) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY nicht gesetzt.');
  const branche = BRANCHE_LABEL[kunde?.branche] || kunde?.branche || '';

  const basePrompt = customPrompt?.trim() || `Fotorealistisches, cinematic Stimmungsbild im Querformat einer Person bei der Tätigkeit "${job.stelle || 'der Stelle'}" in der Branche "${branche}". Authentische Arbeitssituation, warme natürliche Beleuchtung, leichter Bokeh-Effekt, hohe Bildqualität. Komposition geeignet für ein 16:9-Layout (Hauptmotiv mittig, Raum links und rechts). ${job.region ? `Setting passt zur Region ${job.region}. ` : ''}Die Person wirkt selbstbewusst und zufrieden.

ABSOLUT WICHTIG:
- KEIN Text im Bild, KEINE Schrift, KEINE Logos, KEINE Benefit-Tags
- KEIN Overlay, kein Werbe-Layout — das Bild ist ein reines Stimmungsbild
- Keine Stock-Foto-Posen, authentisch wie ein Reportage-Foto`;

  const size = SIZE_MAP[format] || SIZE_MAP.landscape;

  const response = await fetch(OPENAI_IMAGES_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt: basePrompt,
      size,
      quality: 'high',
      n: 1,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI ${response.status}: ${body.slice(0, 400)}`);
  }
  const data = await response.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI: keine Bild-Daten in Response.');

  const pngBuffer = Buffer.from(b64, 'base64');
  // PNG → JPEG re-encode (lossless PNG ist für fotografische Stimmungsbilder oft >10 MB,
  // damit überschreitet es das Bucket-Limit. JPEG q=88 ist visuell identisch, ~4× kleiner)
  const jpgBuffer = await sharp(pngBuffer).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  const path = `${job.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const url = await uploadBuffer({
    bucket: FUNNEL_BUCKET, path, buffer: jpgBuffer, contentType: 'image/jpeg',
  });
  return { url, prompt: basePrompt };
}

/* ───────────────────── Crop (16:9) ───────────────────── */

// Lädt sourceUrl, schneidet auf den übergebenen Pixel-Bereich (vom Frontend),
// uploaded das Ergebnis als neue Datei in den Funnel-Bucket. Original bleibt erhalten.
export async function cropFunnelImage(sourceUrl, { x, y, width, height }, jobId) {
  if (!sourceUrl) throw new Error('source_url fehlt.');
  const left = Math.max(0, Math.round(x));
  const top = Math.max(0, Math.round(y));
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));

  const { buffer } = await fetchAsBuffer(sourceUrl);
  // Bei extract die echte Bildgröße respektieren — sharp wirft sonst auf out-of-bounds
  const meta = await sharp(buffer).metadata();
  const safeLeft = Math.min(left, Math.max(0, meta.width - 1));
  const safeTop = Math.min(top, Math.max(0, meta.height - 1));
  const safeW = Math.min(w, meta.width - safeLeft);
  const safeH = Math.min(h, meta.height - safeTop);

  const cropped = await sharp(buffer)
    .extract({ left: safeLeft, top: safeTop, width: safeW, height: safeH })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();

  const path = `${jobId}/cropped-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.jpg`;
  const url = await uploadBuffer({
    bucket: FUNNEL_BUCKET, path, buffer: cropped, contentType: 'image/jpeg',
  });
  return { url };
}
