// Funnel-Helpers: Fragen-Vorschläge via Claude + Stimmungsbild via gpt-image-1.

import { callClaudeWithRetry, parseJsonContent } from './claude.js';
import { uploadBuffer } from './storage.js';

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

/* ───────────────────── Stimmungsbild generieren ───────────────────── */

export async function generateFunnelImage({ job, kunde, customPrompt, format = 'square' }) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY nicht gesetzt.');
  const branche = BRANCHE_LABEL[kunde?.branche] || kunde?.branche || '';

  const basePrompt = customPrompt?.trim() || `Fotorealistisches, cinematic Stimmungsbild einer Person bei der Tätigkeit "${job.stelle || 'der Stelle'}" in der Branche "${branche}". Authentische Arbeitssituation, warme natürliche Beleuchtung, leichter Bokeh-Effekt, hohe Bildqualität. ${job.region ? `Setting passt zur Region ${job.region}. ` : ''}Die Person wirkt selbstbewusst und zufrieden.

ABSOLUT WICHTIG:
- KEIN Text im Bild, KEINE Schrift, KEINE Logos, KEINE Benefit-Tags
- KEIN Overlay, kein Werbe-Layout — das Bild ist ein reines Stimmungsbild
- Keine Stock-Foto-Posen, authentisch wie ein Reportage-Foto`;

  const size = format === 'portrait' ? '1024x1536' : '1024x1024';

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
