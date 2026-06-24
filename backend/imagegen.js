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

/* ───────────────────────── Spruch-Vorschläge (Headline) ───────────────────────── */

/**
 * Spruch-Vorschläge — wahlweise mit Bild-Analyse (Claude Vision):
 *  - opts.bildUrl:        wenn gesetzt, analysiert Claude die Bildszene und passt die Sprüche an
 *  - opts.kontextHinweis: optionale Mitarbeiter-Notiz zum Bild ("Das sind die zwei Chefs, die rumblödeln")
 *  - opts.motiv:          optionaler Motiv-Beschreibungstext (KI-Modus)
 */
export async function generateSpruchVorschlaege(job, kunde, opts = {}) {
  const { bildUrl, kontextHinweis, motiv } = opts;
  const stelle = job.stelle || 'Mitarbeiter:in';
  const branche = BRANCHE_LABEL[kunde?.branche] || kunde?.branche || '';
  const benefits = Array.isArray(job.benefits) ? job.benefits.filter(Boolean).slice(0, 4) : [];
  const region = job.region || '';

  const baseRules = `ANFORDERUNGEN an JEDEN Spruch:
- Max. 5-8 Wörter — knapp und auf den Punkt
- Emotional, neugierig machend (Curiosity) oder unerwartet
- Sprich den Kandidaten direkt an (Du-Form möglich, aber nicht zwingend)
- KEIN "Wir suchen dich"-Klischee, KEIN "Jetzt bewerben", KEIN reines Stellentitel-Wiederholen
- Stil: leicht provokant, augenzwinkernd, oder eine starke Frage — Hauptsache scroll-stoppend

Gute Beispiele für andere Stellen (zur Inspiration, nicht 1:1 kopieren):
- "Hände, die was bewegen."
- "Schluss mit Schichtdienst-Bullshit."
- "Dein Werkzeug. Deine Regeln."
- "Wo Pflege noch Pflege ist."
- "Mehr als nur ein Job."

Liefere 4 UNTERSCHIEDLICHE Varianten — verschiedene Tonalitäten (1× emotional, 1× provokant/direkt, 1× Frage, 1× Benefit-fokussiert).

Antworte NUR mit JSON, keine Markdown-Backticks:

{ "sprueche": ["Spruch 1", "Spruch 2", "Spruch 3", "Spruch 4"] }`;

  const kontextZeile = `Stelle: "${stelle}"${branche ? ` · Branche ${branche}` : ''}${region ? ` · ${region}` : ''}${benefits.length ? ` · Benefits: ${benefits.join(', ')}` : ''}${motiv?.trim() ? ` · Motiv: "${motiv.trim()}"` : ''}`;

  // ── Variante 1: MIT Bild (Vision) ──
  if (bildUrl) {
    const kontextNote = kontextHinweis?.trim()
      ? `\n\nHINWEIS VOM MITARBEITER zum Bild (sehr wichtig — beachten!): "${kontextHinweis.trim()}"`
      : '';
    const visionPrompt = `Du bist Copywriter für High-Performance Recruiting-Ads (Facebook/Instagram).

KONTEXT: ${kontextZeile}${kontextNote}

AUFGABE:
1. Schau dir das Bild GENAU an: Was siehst du? Welche Stimmung? Welche Personen, Tätigkeit, Atmosphäre, welcher Moment ist eingefangen?
2. Schlage dann 4 starke deutsche Sprüche/Headlines vor, die DIREKT auf diese Bildszene Bezug nehmen — z.B. eine Tätigkeit, eine Geste, eine Mimik, ein Detail. Die Sprüche sollen sich anfühlen als wären sie speziell für GENAU dieses Bild geschrieben.

${baseRules}`;

    const data = await callClaudeWithRetry({
      model: CLAUDE_MODEL,
      max_tokens: 700,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: bildUrl } },
          { type: 'text', text: visionPrompt },
        ],
      }],
    });
    const parsed = parseJsonContent(data);
    return Array.isArray(parsed.sprueche) ? parsed.sprueche.slice(0, 4) : [];
  }

  // ── Variante 2: OHNE Bild — Fallback wie bisher ──
  const prompt = `Du bist Copywriter für High-Performance Recruiting-Ads (Facebook/Instagram). Schlage 4 starke deutsche Sprüche/Headlines vor.

KONTEXT: ${kontextZeile}

${baseRules}`;

  const data = await callClaudeWithRetry({
    model: CLAUDE_MODEL,
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }],
  });
  const parsed = parseJsonContent(data);
  return Array.isArray(parsed.sprueche) ? parsed.sprueche.slice(0, 4) : [];
}

export async function verbessereSpruch({ spruch, job, kunde }) {
  if (!spruch?.trim()) return [];
  const stelle = job?.stelle || '';
  const branche = BRANCHE_LABEL[kunde?.branche] || kunde?.branche || '';

  const prompt = `Du bist Copywriter für High-Performance Recruiting-Ads. Du bekommst einen bestehenden Spruch und sollst ihn STÄRKER, KNACKIGER und CATCHIER machen.

KONTEXT: Stelle "${stelle}"${branche ? `, Branche ${branche}` : ''}.

URSPRUNGSSPRUCH: "${spruch.trim()}"

AUFGABE: Liefere 3 verbesserte Varianten — jeweils:
- Max. 5-6 Wörter
- Behält die Grund-Idee/Botschaft des Originals
- ABER: schärfer, emotionaler, mehr Punch, scroll-stoppender
- KEIN "Wir suchen dich", KEIN "Jetzt bewerben"
- Variante 1: dieselbe Aussage, aber prägnanter
- Variante 2: emotionaler/persönlicher
- Variante 3: provokanter/mutiger

Antworte NUR mit JSON, keine Markdown-Backticks:

{ "varianten": ["Variante 1", "Variante 2", "Variante 3"] }`;

  const data = await callClaudeWithRetry({
    model: CLAUDE_MODEL,
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  });
  const parsed = parseJsonContent(data);
  return Array.isArray(parsed.varianten) ? parsed.varianten.slice(0, 3) : [];
}

/* ───────────────────────── Prompt-Composer ───────────────────────── */

function pickBenefits(job) {
  const arr = Array.isArray(job.benefits) ? job.benefits.filter(Boolean) : [];
  let benefits = arr.slice(0, 4);
  if (benefits.length === 0 && job.gehalt) benefits.push(job.gehalt);
  if (benefits.length === 0) benefits.push('Top Team', 'Faire Bezahlung');
  return benefits.slice(0, 4);
}

// Baut eine kompakte Farb-Anweisung aus kunde.farben — leer wenn keine Farben hinterlegt.
function buildFarbenHinweis(kunde) {
  const f = kunde?.farben;
  if (!f || (!f.primaer && !f.sekundaer && !f.akzent)) return '';
  const parts = [];
  if (f.primaer)   parts.push(`Primär ${f.primaer}`);
  if (f.sekundaer) parts.push(`Sekundär ${f.sekundaer}`);
  if (f.akzent)    parts.push(`Akzent ${f.akzent}`);
  return `MARKENFARBEN: ${parts.join(', ')}. Verwende diese Farben für Text-Overlay, Benefit-Tags, Akzent-Linien und den dunklen Verlauf — das Design soll zur Corporate Identity des Unternehmens passen. Die Hauttöne und natürlichen Bildelemente bleiben davon unberührt.`;
}

// Sorgt für korrekte Stellendarstellung mit Geschlechtskürzel: "Bauhelfer" → "Bauhelfer (m/w/d)"
function stelleDisplay(stelle) {
  if (!stelle) return 'Mitarbeiter:in (m/w/d)';
  if (/\([mwfd][\/\\mwfd\s\-]+\)/i.test(stelle)) return stelle.trim();
  return `${stelle.trim()} (m/w/d)`;
}

// Nur der reine Ort — entfernt Umkreis-Suffixe wie "+30km", "(30km Umkreis)" etc.
function cleanOrt(region) {
  if (!region) return '';
  return String(region)
    .replace(/\s*[\(\[\+,]\s*\d+\s*km\s*(umkreis)?\s*[\)\]]?/gi, '')
    .replace(/\s*umkreis\s+\d+\s*km/gi, '')
    .replace(/\s*\(\s*umkreis\s*\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Prompt für Modus "ki" — komplett neues Bild generieren, optional mit Person als Vorlage.
function buildPromptKI({ job, kunde, motiv, format, hasLogo, person, spruch }) {
  const stelle = stelleDisplay(job.stelle);
  const ort = cleanOrt(job.region);
  const branche = BRANCHE_LABEL[kunde?.branche] || kunde?.branche || '';
  const firmenname = kunde?.firmenname || '';
  const benefits = pickBenefits(job);
  const benefitListe = [...benefits.map(b => `"${b}"`), '"u.v.m."'].join(', ');
  const orientation = format === 'story' ? 'hochkant (2:3, geeignet für Stories/Reels)' : 'quadratisch (1:1, geeignet für Feed-Posts)';
  const farben = buildFarbenHinweis(kunde);

  const refHinweis = [];
  if (hasLogo && person) {
    refHinweis.push(
      `MITGELIEFERTE BILDER (in dieser Reihenfolge):`,
      `[BILD 1 — DATEINAME "firmenlogo"] = FIRMENLOGO. Diese Datei ist AUSSCHLIESSLICH ein Marken-Element für den Logo-Abdruck. Platziere das Logo klein und dezent oben rechts im Creative (ca. 10% der Bildbreite, klare Kanten, transparenter Hintergrund respektiert). VERWENDE DIESES BILD NICHT als Person, NICHT als Hintergrund, NICHT als Stil-Referenz, NICHT für Bildkomposition.`,
      `[BILD 2 — DATEINAME "person"] = HAUPTMOTIV. Foto einer realen Person${person.beschreibung ? ` (Beschreibung: "${person.beschreibung}")` : ''}. DIESE Person ist die Hauptfigur des Creatives. Übernimm Gesichtszüge, Hauttyp, Haarfarbe, Frisur und Statur aus diesem Foto und stelle GENAU DIESE Person in der unten beschriebenen Szene dar — sie muss als dieselbe Person erkennbar bleiben. Kleidung darf der neuen Tätigkeit angepasst werden, das Gesicht NICHT.`,
    );
  } else if (hasLogo) {
    refHinweis.push(`MITGELIEFERTES BILD = FIRMENLOGO. Ausschließlich Marken-Element. Platziere es klein und dezent oben rechts im Creative (ca. 10% der Bildbreite). NICHT als Hauptmotiv, NICHT als Stil-Referenz verwenden — nur als Logo-Abdruck.`);
  } else if (person) {
    refHinweis.push(`MITGELIEFERTES BILD = HAUPTMOTIV. Foto einer realen Person${person.beschreibung ? ` (Beschreibung: "${person.beschreibung}")` : ''}. Übernimm Gesichtszüge, Hauttyp, Haarfarbe, Frisur und Statur und stelle GENAU DIESE Person in der unten beschriebenen Szene dar — sie muss als dieselbe Person erkennbar bleiben.`);
  }

  return `Erstelle ein hochwertiges Social Media Recruiting Ad ${orientation} im modernen Instagram/Facebook Stil.

${refHinweis.length ? refHinweis.join('\n') + '\n\n' : ''}${farben ? farben + '\n\n' : ''}BILDMOTIV (Hintergrund / Szene):
${motiv}
- Fotorealistisch, cinematic Look, warme Farben, leichter Bokeh-Effekt
- Branche: ${branche}
- Authentisch, Person(en) selbstbewusst und zufrieden — keine gestellten Stock-Fotos${person ? '\n- Die Person aus dem Referenzbild ist die Hauptfigur in dieser Szene.' : ''}

TEXT-ELEMENTE (in dieser Reihenfolge von oben nach unten, sauber lesbar):
1. ${hasLogo
    ? `LOGO oben rechts: dezent, klein (max. 10% Bildbreite), klare Kanten. KEIN zusätzlicher Firmenname-Text neben oder unter dem Logo — das Logo allein dient der Markenidentifikation.`
    : `FIRMENNAME-SCHRIFTZUG oben rechts (oder oben mittig): "${firmenname}" als sauberer, dezenter Text-Schriftzug in einer modernen Schrift (max. 12% Bildhöhe). Das ist der Markenanker — kein zusätzliches Logo-Element.`}
2. HAUPTSPRUCH zentral: ${spruch?.trim()
    ? `Verwende EXAKT diesen Wortlaut: "${spruch.trim()}". GROSS, fett, sofort fesselnd. Erfinde KEINEN eigenen Spruch — nutze GENAU diese Wörter, ggf. mit Zeilenumbruch (2-3 Wörter pro Zeile).`
    : 'ein emotionaler, kurzer Recruiting-Spruch (max. 5-6 Wörter, idealerweise 2-3 Wörter pro Zeile bei mehrzeiligem Umbruch), passend zur Stelle — GROSS, fett, sofort fesselnd. KEIN "Wir suchen dich"-Klischee, KEIN "Jetzt bewerben" hier oben.'}
3. STELLENBEZEICHNUNG direkt unter dem Hauptspruch — ALS EIGENSTÄNDIGES, GROSSES ELEMENT: "${stelle}". Fast so groß wie der Hauptspruch (ca. 70-80% der Größe), in einer KONTRASTFARBE oder mit einer farbigen Linie/Box/Hintergrundfläche klar hervorgehoben. Ein Scroller muss in einer Sekunde erkennen welche Stelle angeboten wird. WICHTIG: das "(m/w/d)" am Ende MUSS lesbar dargestellt werden — entweder direkt im selben Textblock oder als kleiner Untertitel.
${ort ? `4. STANDORT direkt unter der Stellenbezeichnung: "📍 ${ort}" — dezent, ca. 40% der Höhe der Stellenbezeichnung, gleiche Schriftart. Nur der Ort, KEIN Umkreis/Radius.\n5` : '4'}. BENEFIT-TAGS unten: 3-4 kompakte, abgerundete Pill-Boxen mit Icons nebeneinander: ${benefitListe}
   Benefits kompakt halten — kurze Begriffe wie "Firmenwagen", "Tankkarte", "30 Tage Urlaub", keine Sätze
${ort ? '6' : '5'}. CALL-TO-ACTION ganz unten: "Jetzt bewerben" — klein, dezent, gerne mit Pfeil

DESIGN-REGELN:
- HIERARCHIE der Größen: Hauptspruch (groß) > Stellenbezeichnung (fast genauso groß, mit Kontrast-Hintergrund/Linie) > Benefits (klein) > Firmenname & CTA (sehr klein)
- Dunkler, halbtransparenter Verlauf hinter den Texten für Lesbarkeit, ohne das Hintergrundbild zu zerstören
- Schrift modern, sehr lesbar; Hauptspruch UND Stellenbezeichnung beide Bold
- ${farben ? 'Markenfarben konsequent für Text + Akzent-Linien + Box hinter der Stellenbezeichnung (so wird die CI getragen).' : 'Verwende eine kräftige Akzentfarbe (z.B. lime, orange, türkis) für die Stellenbezeichnungs-Box, damit sie aus dem Bild heraussticht.'}
- Keine QR-Codes, keine Rahmen ums ganze Bild
- Muss auf dem Handy sofort ins Auge springen und Scroll-Stop erzeugen`;
}

// Prompt für Modus "foto" — Foto als Hintergrund unverändert übernehmen, nur Overlay hinzufügen.
function buildPromptFoto({ job, kunde, format, hasLogo, spruch }) {
  const stelle = stelleDisplay(job.stelle);
  const ort = cleanOrt(job.region);
  const firmenname = kunde?.firmenname || '';
  const benefits = pickBenefits(job);
  const benefitListe = [...benefits.map(b => `"${b}"`), '"u.v.m."'].join(', ');
  const orientation = format === 'story' ? 'hochkant (2:3, geeignet für Stories/Reels)' : 'quadratisch (1:1, geeignet für Feed-Posts)';
  const farben = buildFarbenHinweis(kunde);

  const refLines = hasLogo
    ? `MITGELIEFERTE BILDER (in dieser Reihenfolge):
[BILD 1 — DATEINAME "firmenlogo"] = FIRMENLOGO. Ausschließlich Marken-Element. Platziere es klein und dezent oben rechts (ca. 10% Bildbreite). NICHT als Hauptmotiv, NICHT als Stil-Referenz verwenden.
[BILD 2 — DATEINAME "hintergrundfoto"] = HINTERGRUND. Übernimm dieses Foto EXAKT als Hintergrund, ohne es zu verändern: keine Personen austauschen, keine Komposition ändern, keine Farben verfälschen, keine Filter, kein neuer Bildstil. Es bleibt der echte, originale Foto-Look.`
    : `MITGELIEFERTES BILD = HINTERGRUND. Übernimm dieses Foto EXAKT als Hintergrund, ohne es zu verändern: keine Personen austauschen, keine Komposition ändern, keine Farben verfälschen, keine Filter, kein neuer Bildstil. Es bleibt der echte, originale Foto-Look.`;

  return `Erstelle ein professionelles Recruiting-Ad-Overlay ${orientation} im modernen Instagram/Facebook Stil.

${refLines}

${farben ? farben + '\n\n' : ''}Falls das Hintergrundfoto nicht im Zielformat ist, beschneide es respektvoll (Person/wesentliche Bildelemente sichtbar lassen).

OVERLAY-ELEMENTE (zusätzlich zum unveränderten Foto, in dieser Reihenfolge von oben nach unten):
1. ${hasLogo
    ? `LOGO oben rechts: dezent, klein (max. 10% Bildbreite), klare Kanten. KEIN zusätzlicher Firmenname-Text neben oder unter dem Logo — das Logo allein dient der Markenidentifikation.`
    : `FIRMENNAME-SCHRIFTZUG oben rechts (oder oben mittig): "${firmenname}" als sauberer, dezenter Text-Schriftzug in einer modernen Schrift (max. 12% Bildhöhe). Das ist der Markenanker — kein zusätzliches Logo-Element.`}
2. HAUPTSPRUCH zentral oder im oberen Drittel: ${spruch?.trim()
    ? `Verwende EXAKT diesen Wortlaut: "${spruch.trim()}". GROSS, fett, sofort fesselnd. Erfinde KEINEN eigenen Spruch — nutze GENAU diese Wörter, ggf. mit Zeilenumbruch (2-3 Wörter pro Zeile).`
    : 'kurzer Recruiting-Spruch (max. 5-6 Wörter, idealerweise 2-3 Wörter pro Zeile), passend zur Stelle — GROSS, fett, sofort fesselnd. KEIN "Wir suchen dich"-Klischee, KEIN "Jetzt bewerben" hier oben.'}
3. STELLENBEZEICHNUNG direkt unter dem Hauptspruch — ALS EIGENSTÄNDIGES, GROSSES ELEMENT: "${stelle}". Fast so groß wie der Hauptspruch (ca. 70-80%), in einer KONTRASTFARBE oder mit einer farbigen Linie/Box/Hintergrundfläche hervorgehoben. Ein Scroller muss in einer Sekunde erkennen welche Stelle angeboten wird. WICHTIG: das "(m/w/d)" MUSS lesbar dargestellt werden.
${ort ? `4. STANDORT direkt unter der Stellenbezeichnung: "📍 ${ort}" — dezent, ca. 40% der Höhe der Stellenbezeichnung. Nur der Ort, KEIN Umkreis/Radius.\n5` : '4'}. BENEFIT-TAGS unten: 3-4 kompakte abgerundete Pill-Boxen mit Icons nebeneinander: ${benefitListe}
${ort ? '6' : '5'}. CALL-TO-ACTION ganz unten: "Jetzt bewerben" — klein, dezent

DESIGN-REGELN:
- HIERARCHIE der Größen: Hauptspruch (groß) > Stellenbezeichnung (fast genauso groß, mit Kontrast) > Benefits (klein) > Firmenname & CTA (sehr klein)
- Dunkler, halbtransparenter Verlauf (Gradient) hinter den Texten — sorgt für Lesbarkeit ohne das Foto zu zerstören
- Schrift modern, sehr lesbar; Hauptspruch UND Stellenbezeichnung beide Bold
- ${farben ? 'Markenfarben konsequent für Text + Akzent-Linien + Stellen-Box.' : 'Kräftige Akzentfarbe (lime, orange, türkis o.ä.) für die Stellen-Box, damit sie aus dem Foto heraussticht.'}
- Keine zusätzlichen Filter aufs Foto, keine Verfremdung, keine Stilisierung
- Keine QR-Codes, keine Rahmen ums ganze Bild
- Wirkung: das echte Foto bleibt der Held, Text-Overlay (besonders Spruch + Stellenbezeichnung) erzeugt Scroll-Stop`;
}

// Wrapper — wählt den passenden Prompt anhand des Modus.
export function buildCreativePrompt({ job, kunde, motiv, format, mode = 'ki', hasLogo, person, spruch }) {
  if (mode === 'foto') return buildPromptFoto({ job, kunde, format, hasLogo, spruch });
  return buildPromptKI({ job, kunde, motiv, format, hasLogo, person, spruch });
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

// Lädt URLs nacheinander als Buffer + Mime und liefert sie als Liste — isLogo wird durchgereicht!
async function loadReferenceImages(refs) {
  const out = [];
  for (const ref of refs) {
    if (!ref?.url) continue;
    try {
      const { buffer, contentType } = await fetchAsBuffer(ref.url);
      out.push({
        buffer, contentType,
        name: ref.name || 'ref',
        isLogo: !!ref.isLogo,
      });
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
//   mode='ki'   → komplett neu generieren (optional mit Person als Vorlage)
//   mode='foto' → Foto als Hintergrund übernehmen, nur Overlay (Foto MUSS in referenceImages enthalten sein)
// referenceImages-Reihenfolge: Logo (isLogo:true) IMMER zuerst falls vorhanden, dann Person/Foto.
export async function generateOneCreative({ job, kunde, motiv, format, mode = 'ki', referenceImages = [], spruch }) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY nicht gesetzt.');
  const size = FORMAT_SIZE[format];
  if (!size) throw new Error(`Unbekanntes Format: ${format}`);
  if (mode === 'foto' && !referenceImages.some(r => !r.isLogo)) {
    throw new Error('Modus "foto" benötigt ein Hintergrund-Foto.');
  }

  const refs = await loadReferenceImages(referenceImages);
  const hasLogo = !!referenceImages[0]?.isLogo;
  const person = referenceImages.find(r => !r.isLogo) || null;
  const prompt = buildCreativePrompt({ job, kunde, motiv, format, mode, hasLogo, person, spruch });

  let response;
  if (refs.length > 0) {
    // Sortierung erzwingen: Logo IMMER zuerst → so erwartet's auch der Prompt
    refs.sort((a, b) => (b.isLogo ? 1 : 0) - (a.isLogo ? 1 : 0));
    console.log(`[imagegen] format=${format} mode=${mode} refs=[${refs.map(r => r.isLogo ? 'logo' : 'person').join(', ')}]`);

    const form = new FormData();
    form.append('model', 'gpt-image-2');
    form.append('prompt', prompt);
    form.append('size', size);
    form.append('quality', 'high');
    form.append('n', '1');
    refs.forEach((r) => {
      const ext = r.contentType.includes('png') ? 'png' : (r.contentType.includes('webp') ? 'webp' : 'jpg');
      const fileName = r.isLogo ? `firmenlogo.${ext}` : (mode === 'foto' ? `hintergrundfoto.${ext}` : `person.${ext}`);
      form.append('image[]', bufferToFile(r.buffer, fileName, r.contentType));
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
export async function generateVariant({ job, kunde, motiv, mode = 'ki', referenceImages = [], spruch }) {
  const formats = ['quadrat', 'story'];
  const results = await Promise.allSettled(
    formats.map(format => generateOneCreative({ job, kunde, motiv, format, mode, referenceImages, spruch })),
  );
  const ok = results.filter(r => r.status === 'fulfilled').map(r => r.value);
  const errors = results.filter(r => r.status === 'rejected').map(r => r.reason.message);
  return { ok, errors };
}
