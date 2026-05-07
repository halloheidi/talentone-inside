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

export async function generateFragenVorschlaege(job, kunde) {
  const fd = job.formdata_komplett || {};
  const branche = BRANCHE_LABEL[kunde?.branche] || kunde?.branche || '';
  const kontext = `Stelle: ${job.stelle || '-'}
Branche: ${branche}
Region: ${job.region || '-'}
Geforderte Ausbildung: ${fd.ausbildung || '-'}
Quereinsteiger willkommen: ${job.quereinsteiger ? 'ja' : 'nein'}
Reisebereitschaft erforderlich: ${job.reisebereitschaft ? 'ja' : 'nein'}`;

  const prompt = `Du bist Recruiting-Funnel-Experte. Schlage 4-6 prägnante Multiple-Choice-Fragen für eine Bewerbungsseite vor — eine pro Screen.

${kontext}

Branchenspezifisch sinnvoll fragen:
- Handwerk: Gesellenbrief / Meister, Führerschein-Klassen, Berufserfahrung
- Pflege: Examiniert, Schichtbereitschaft, Wochenendarbeit
- Logistik: Führerschein-Klassen, Schichtbereitschaft
- Allgemein: Verfügbarkeit (Start), Berufserfahrung, Motivation

Pro Frage:
- text: KURZ (max 10 Wörter), Du-Ansprache, freundlich, NICHT bürokratisch
- options: 2-4 Antwort-Optionen, KURZ (1-3 Wörter idealerweise)
- "Sonstiges" oder "Lieber persönlich" ist OK als 4. Option

Antworte NUR mit JSON, keine Markdown-Backticks, keine ID-Felder (die generieren wir):
{
  "fragen": [
    { "text": "...", "options": ["...", "..."] }
  ]
}`;

  const data = await callClaudeWithRetry({
    model: CLAUDE_MODEL,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });
  const parsed = parseJsonContent(data);
  const fragen = Array.isArray(parsed.fragen) ? parsed.fragen : [];
  return fragen.slice(0, 6).map(f => ({
    text: String(f.text || '').trim(),
    options: Array.isArray(f.options) ? f.options.map(o => String(o).trim()).filter(Boolean).slice(0, 4) : [],
  })).filter(f => f.text && f.options.length >= 2);
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

  const buffer = Buffer.from(b64, 'base64');
  const path = `${job.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const url = await uploadBuffer({
    bucket: FUNNEL_BUCKET, path, buffer, contentType: 'image/png',
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
    .png({ quality: 92 })
    .toBuffer();

  const path = `${jobId}/cropped-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.png`;
  const url = await uploadBuffer({
    bucket: FUNNEL_BUCKET, path, buffer: cropped, contentType: 'image/png',
  });
  return { url };
}
