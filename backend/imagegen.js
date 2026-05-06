// Bild-Generierung für TalentOne Inside.
// - generateMotivVorschlaege: Claude schlägt 3 Bildmotive vor (basierend auf Job + Branche).
// - generateCreative:        OpenAI gpt-image-2 erzeugt ein Recruiting-Ad in einem Format,
//                            Upload nach Supabase Storage (Bucket: talentone-creatives).

import { callClaudeWithRetry, parseJsonContent } from './claude.js';
import { fetchAsBuffer } from './storage.js';

const OPENAI_IMAGES_API = 'https://api.openai.com/v1/images/generations';
const OPENAI_EDITS_API = 'https://api.openai.com/v1/images/edits';
export const STORAGE_BUCKET = 'talentone-creatives';

const CLAUDE_MODEL = 'claude-sonnet-4-6';

// Format → OpenAI image size (gpt-image-2 unterstützt 1024x1024, 1024x1536, 1536x1024)
const FORMAT_SIZE = {
  quadrat: '1024x1024',  // 1:1 — Feed
  story: '1024x1536',    // 2:3 — nahe an 9:16, von gpt-image-2 supported
};

const BRANCHE_LABEL = {
  handwerk: 'Handwerk & Bau',
  pflege: 'Pflege & Soziales',
  einzelhandel: 'Einzelhandel',
  gastro: 'Gastronomie & Hotel',
  buero: 'Büro & Verwaltung',
  logistik: 'Logistik & Transport',
};

/* ───────────────────────── Motiv-Vorschläge ───────────────────────── */

export async function generateMotivVorschlaege(job, kunde) {
  const stelle = job.stelle || 'Mitarbeiter:in';
  const branche = BRANCHE_LABEL[kunde?.branche] || kunde?.branche || '';
  const region = job.region || '';

  const prompt = `Du bist Bildregisseur für Recruiting-Ads. Schlage 3 unterschiedliche, konkrete Bildmotive vor für die Stelle "${stelle}"${branche ? ` in der Branche ${branche}` : ''}${region ? ` (${region})` : ''}.

Jedes Motiv:
- 1 Satz, 12-20 Wörter
- konkret, sinnlich, fotografisch (Licht, Setting, Tätigkeit)
- authentisch, kein Stock-Foto-Klischee
- KEINE Texte, Logos oder UI-Elemente im Motiv erwähnen — das macht der Composer

Antworte NUR mit JSON, keine Markdown-Backticks:

{ "motive": ["Motiv 1", "Motiv 2", "Motiv 3"] }`;

  const data = await callClaudeWithRetry({
    model: CLAUDE_MODEL,
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  });
  const parsed = parseJsonContent(data);
  return Array.isArray(parsed.motive) ? parsed.motive.slice(0, 3) : [];
}

/* ───────────────────────── Prompt-Composer ───────────────────────── */

function pickBenefits(job) {
  const arr = Array.isArray(job.benefits) ? job.benefits.filter(Boolean) : [];
  let benefits = arr.slice(0, 4);
  if (benefits.length === 0 && job.gehalt) benefits.push(job.gehalt);
  if (benefits.length === 0) benefits.push('Top Team', 'Faire Bezahlung');
  return benefits.slice(0, 4);
}

export function buildCreativePrompt({ job, kunde, motiv, format, hasLogo, hasReferenz }) {
  const stelle = job.stelle || 'Mitarbeiter:in';
  const branche = BRANCHE_LABEL[kunde?.branche] || kunde?.branche || '';
  const firmenname = kunde?.firmenname || '';
  const benefits = pickBenefits(job);
  const benefitListe = [...benefits.map(b => `"${b}"`), '"u.v.m."'].join(', ');
  const orientation = format === 'story' ? 'hochkant (2:3, geeignet für Stories/Reels)' : 'quadratisch (1:1, geeignet für Feed-Posts)';

  const refHinweis = [];
  if (hasLogo && hasReferenz) {
    refHinweis.push(
      `MITGELIEFERTE BILDER: Das ERSTE Referenzbild ist das LOGO des Unternehmens — platziere es dezent, klein und sauber oben rechts im Creative (max. 12% der Bildbreite, klare Kanten, ohne Filter, ohne Schatten).`,
      `Das ZWEITE Bild ist eine STIL-REFERENZ aus dem echten Betrieb — übernimm die Lichtstimmung, Farbpalette und Authentizität dieses Bildes für das Hintergrundmotiv. Greife Atmosphäre und Bildsprache auf, übersetze sie aber in eine professionelle Recruiting-Ad-Komposition.`,
    );
  } else if (hasLogo) {
    refHinweis.push(`MITGELIEFERTES BILD: Das ist das LOGO des Unternehmens — platziere es dezent, klein und sauber oben rechts im Creative (max. 12% der Bildbreite, klare Kanten, ohne Filter, ohne Schatten).`);
  } else if (hasReferenz) {
    refHinweis.push(`MITGELIEFERTES BILD: Das ist eine STIL-REFERENZ aus dem echten Betrieb — übernimm Lichtstimmung, Farbpalette und Authentizität für das Hintergrundmotiv. Greife Atmosphäre und Bildsprache auf, übersetze sie in eine professionelle Recruiting-Ad-Komposition.`);
  }

  return `Erstelle ein hochwertiges Social Media Recruiting Ad ${orientation} im modernen Instagram/Facebook Stil.

${refHinweis.length ? refHinweis.join('\n\n') + '\n\n' : ''}BILDMOTIV (Hintergrund):
${motiv}
- Fotorealistisch, cinematic Look, warme Farben, leichter Bokeh-Effekt
- Branche: ${branche}
- Authentisch, Person(en) selbstbewusst und zufrieden — keine gestellten Stock-Fotos

TEXT-ELEMENTE (sauber lesbar, modernes Design):
- Oben: Firmenname "${firmenname}" in kleiner, eleganter Schrift${hasLogo ? ' (links neben dem Logo, oder als Untertitel darunter)' : ''}
- Mittig: Ein emotionaler, kurzer Recruiting-Spruch (max. 5-6 Wörter), passend zur Stelle "${stelle}" — motivierend, auf Augenhöhe, kein "Wir suchen dich"-Klischee
- Unten: 3-4 Benefit-Tags in kleinen, abgerundeten Boxen mit Icons nebeneinander: ${benefitListe}
- Benefits kompakt halten — kurze Begriffe wie "Firmenwagen", "Tankkarte", "30 Tage Urlaub", nicht ganze Sätze
- Ganz unten: Kleiner Call-to-Action "Jetzt bewerben"

DESIGN-REGELN:
- Dunkler, halbtransparenter Verlauf im unteren Drittel für Textlesbarkeit
- Schrift weiß, modern, Bold für den Hauptspruch
- Benefit-Tags klein gehalten damit alle nebeneinander reinpassen
- Farben warm und einladend, passend zur Branche
- Keine QR-Codes, keine Rahmen
- Muss auf dem Handy sofort ins Auge springen und zum Stoppen beim Scrollen bewegen`;
}

/* ───────────────────────── Bild-Generierung ───────────────────────── */

async function uploadToStorage(buffer, filename, contentType = 'image/png') {
  const url = `${process.env.SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${filename}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    body: buffer,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Storage ${res.status}: ${body.slice(0, 300)}`);
  }
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${filename}`;
}

export async function deleteFromStorage(publicUrl) {
  if (!publicUrl) return;
  const marker = `/storage/v1/object/public/${STORAGE_BUCKET}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx < 0) return;
  const path = publicUrl.slice(idx + marker.length);
  const res = await fetch(
    `${process.env.SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${path}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
    },
  );
  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    console.warn(`[Storage] Delete fehlgeschlagen ${res.status}: ${body.slice(0, 200)}`);
  }
}

// Lädt URLs nacheinander als Buffer + Mime und liefert sie als Liste {buffer, contentType, name}.
async function loadReferenceImages(refs) {
  const out = [];
  for (const ref of refs) {
    if (!ref?.url) continue;
    try {
      const { buffer, contentType } = await fetchAsBuffer(ref.url);
      out.push({ buffer, contentType, name: ref.name || 'ref.png' });
    } catch (err) {
      console.warn(`[ref-fetch] ${ref.url}: ${err.message}`);
    }
  }
  return out;
}

// Wandelt einen Buffer in einen Web-File für FormData (gpt-image-2 /edits).
function bufferToFile(buf, name, type) {
  return new File([buf], name, { type });
}

// Generiert ein Bild in einem Format und uploaded nach Storage.
// referenceImages: [{ url, name? }] — Logo IMMER zuerst (wird in der Ecke platziert),
// Stil-Referenz danach. Bei mind. einer Referenz nutzt OpenAI /v1/images/edits.
export async function generateOneCreative({ job, kunde, motiv, format, referenceImages = [] }) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY nicht gesetzt.');
  const size = FORMAT_SIZE[format];
  if (!size) throw new Error(`Unbekanntes Format: ${format}`);

  const refs = await loadReferenceImages(referenceImages);
  const hasLogo = !!referenceImages[0]?.isLogo;
  const hasReferenz = referenceImages.some(r => !r.isLogo);
  const prompt = buildCreativePrompt({ job, kunde, motiv, format, hasLogo, hasReferenz });

  let response;
  if (refs.length > 0) {
    const form = new FormData();
    form.append('model', 'gpt-image-2');
    form.append('prompt', prompt);
    form.append('size', size);
    form.append('quality', 'high');
    form.append('n', '1');
    refs.forEach((r, i) => {
      form.append('image[]', bufferToFile(r.buffer, `ref-${i}.${r.contentType.includes('png') ? 'png' : 'jpg'}`, r.contentType));
    });
    response = await fetch(OPENAI_EDITS_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });
  } else {
    response = await fetch(OPENAI_IMAGES_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'gpt-image-2', prompt, size, quality: 'high', n: 1 }),
    });
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI ${response.status}: ${body.slice(0, 400)}`);
  }
  const data = await response.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI: keine Bild-Daten in Response.');

  const buffer = Buffer.from(b64, 'base64');
  const filename = `${job.id}/${format}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const bildUrl = await uploadToStorage(buffer, filename);
  return { format, bildUrl, prompt };
}

// Generiert eine Variante in beiden Formaten (quadrat + story) parallel.
export async function generateVariant({ job, kunde, motiv, referenceImages = [] }) {
  const formats = ['quadrat', 'story'];
  const results = await Promise.allSettled(
    formats.map(format => generateOneCreative({ job, kunde, motiv, format, referenceImages })),
  );
  const ok = results.filter(r => r.status === 'fulfilled').map(r => r.value);
  const errors = results.filter(r => r.status === 'rejected').map(r => r.reason.message);
  return { ok, errors };
}
