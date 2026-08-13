// Bild-Generierung für TalentOne Inside.
// - generateMotivVorschlaege: Claude schlägt 3 Bildmotive vor (basierend auf Job + Branche).
// - generateCreative:        OpenAI gpt-image-2 erzeugt ein Recruiting-Ad in einem Format,
//                            Upload nach Supabase Storage (Bucket: talentone-creatives).

import { callClaudeWithRetry, parseJsonContent } from './claude.js';
import { fetchAsBuffer, uploadBuffer } from './storage.js';
import { supabase } from './supabase.js';
import { makeTransparent, composeLogoOverlay } from './logo.js';
import { extendTo9x16, normalizeImageForOpenAI } from './imageops.js';
import sharp from 'sharp';

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
// Wechsel-Schmerz-Framework — gemeinsam für Spruch-Vorschläge & Verbesserung.
// Zielgruppe: angestellte, wechselwillige Fachkräfte (KEINE Arbeitssuchenden).
const SPRUCH_FRAMEWORK = `ZIELGRUPPE: angestellte, wechselWILLIGE Fachkräfte — KEINE Arbeitssuchenden. Sie haben einen Job und einen Grund, wechseln zu wollen. Adressiere GENAU diesen Wechsel-Schmerz und liefere aus den ECHTEN Stellendaten (Benefits, Besonderheiten, Region) den passenden Gegenpol — nichts erfinden.

WECHSEL-SCHMERZEN — jeder Spruch adressiert GENAU einen. Nutze exakt eines dieser Kategorie-Labels:
- "Montage / Pendeln" → Gegenpol: wohnortnah, kein Pendeln, feste Region, abends zu Hause
- "Technik / Langeweile" → moderne Technik, Abwechslung, Zukunft statt Stillstand
- "Führung / Wertschätzung" → nahbare Chefs, kurze Wege, gesehen werden statt anonym
- "Chaos / Vorbereitung" → klare Abläufe, gute Vorbereitung, Material ist da
- "Kontrolle / Vertrauen" → Eigenverantwortung, Vertrauen statt Kontrolle
- "Gehalt" → konkrete Zahl / faire, pünktliche Bezahlung
- "Feierabend" → planbarer Feierabend, Familienzeit, kein geopferter Feierabend
- "Bewerbungs-Hürde senken" → niederschwelliger Einstieg, erst kennenlernen, Lebenslauf später

STRUKTUR jedes Spruchs:
- EIN kurzer String mit Kontrast-Mechanik (Setup + Payoff): "X RAUS. Y REIN." · "X STATT Y." · "X? Y." · "KEIN X. DAFÜR Y."
- VERSALIEN (Großbuchstaben), KEINE Zeilenumbrüche im Text
- Keine Ausrufezeichen-Ketten, keine Floskeln ("Werde Teil unseres Teams", "Wir suchen dich", "Jetzt bewerben"), kein reines Wiederholen des Stellentitels

QUALITÄTS-ANKER (Mechanik übertragen, NICHT kopieren):
"DEIN ARBEITSWEG? BEGINNT VOR DER HAUSTÜR." · "ALLES DABEI. AUSSER CHAOS." · "DEINE NEUEN CHEFS. DIREKT ANSPRECHBAR." · "PAPIERKRAM RAUS. TABLET REIN." · "DU KANNST HEIZUNG. WIR ZEIGEN DIR ZUKUNFT." · "ERST MAL KENNENLERNEN. PAPIERKRAM SPÄTER."`;

const SPRUCH_JSON_HINT = `Antworte NUR mit JSON, keine Markdown-Backticks:
{ "sprueche": [ { "kategorie": "<exakt eines der Kategorie-Labels>", "text": "DER SPRUCH IN VERSALIEN" } ] }`;

// Normalisiert die Claude-Antwort → [{ text, kategorie }]. Verträgt auch
// Alt-Format (Array von Strings) defensiv.
function normalizeSprueche(parsed) {
  const arr = Array.isArray(parsed?.sprueche) ? parsed.sprueche : [];
  return arr.map(s => {
    if (typeof s === 'string') return { text: s.trim(), kategorie: '' };
    if (s && typeof s === 'object') return { text: String(s.text || '').trim(), kategorie: String(s.kategorie || '').trim() };
    return null;
  }).filter(s => s && s.text).slice(0, 10);
}

export async function generateSpruchVorschlaege(job, kunde, opts = {}) {
  const { bildUrl, kontextHinweis, motiv } = opts;
  const stelle = job.stelle || 'Mitarbeiter:in';
  const branche = BRANCHE_LABEL[kunde?.branche] || kunde?.branche || '';
  const benefits = Array.isArray(job.benefits) ? job.benefits.filter(Boolean).slice(0, 6) : [];
  const region = job.region || '';
  const besonderheiten = (job.besonderheiten || '').trim();

  const kontextZeile = `Stelle: "${stelle}"${branche ? ` · Branche ${branche}` : ''}${region ? ` · Region ${region}` : ''}${benefits.length ? ` · Benefits: ${benefits.join(', ')}` : ''}${besonderheiten ? ` · Besonderheiten: ${besonderheiten}` : ''}${motiv?.trim() ? ` · Motiv: "${motiv.trim()}"` : ''}`;

  // ── Variante 1: MIT Bild/Motiv (Vision) — Spruch muss zum Bildinhalt passen ──
  if (bildUrl) {
    const kontextNote = kontextHinweis?.trim()
      ? `\n\nHINWEIS VOM MITARBEITER zum Bild (sehr wichtig — beachten!): "${kontextHinweis.trim()}"`
      : '';
    const visionPrompt = `Du bist Copywriter für High-Performance Recruiting-Ads. ${SPRUCH_FRAMEWORK}

KONTEXT: ${kontextZeile}${kontextNote}

AUFGABE:
1. Schau dir das Bild GENAU an: Personen, Tätigkeit, Objekte, Stimmung.
2. Wähle die Wechsel-Schmerzen, die zum BILDINHALT passen, und schreibe Sprüche, die sich anfühlen als wären sie für GENAU dieses Bild gemacht. Orientierung: Chef-/Team-Foto → "Führung / Wertschätzung" (kurze Wege, ansprechbar); Fahrzeug → Ausstattung/Region/"Feierabend"; Technik-Nahaufnahme → "Technik / Langeweile" (Können, Zukunft).
3. Liefere 8–10 Sprüche, mindestens einer aus der Kategorie "Bewerbungs-Hürde senken".

${SPRUCH_JSON_HINT}`;

    const data = await callClaudeWithRetry({
      model: CLAUDE_MODEL,
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: bildUrl } },
          { type: 'text', text: visionPrompt },
        ],
      }],
    });
    return normalizeSprueche(parseJsonContent(data));
  }

  // ── Variante 2: OHNE Bild — über mehrere Schmerz-Kategorien streuen ──
  const prompt = `Du bist Copywriter für High-Performance Recruiting-Ads. ${SPRUCH_FRAMEWORK}

KONTEXT: ${kontextZeile}

AUFGABE: Liefere 8–10 Sprüche, GESTREUT über mehrere Wechsel-Schmerz-Kategorien (nicht alle aus derselben), mindestens einer aus "Bewerbungs-Hürde senken". Jeder Spruch mit dem passenden Kategorie-Label.

${SPRUCH_JSON_HINT}`;

  const data = await callClaudeWithRetry({
    model: CLAUDE_MODEL,
    max_tokens: 900,
    messages: [{ role: 'user', content: prompt }],
  });
  return normalizeSprueche(parseJsonContent(data));
}

export async function verbessereSpruch({ spruch, job, kunde }) {
  if (!spruch?.trim()) return [];
  const stelle = job?.stelle || '';
  const branche = BRANCHE_LABEL[kunde?.branche] || kunde?.branche || '';
  const benefits = Array.isArray(job?.benefits) ? job.benefits.filter(Boolean).slice(0, 6) : [];
  const region = job?.region || '';

  const prompt = `Du bist Copywriter für High-Performance Recruiting-Ads. ${SPRUCH_FRAMEWORK}

KONTEXT: Stelle "${stelle}"${branche ? `, Branche ${branche}` : ''}${region ? `, Region ${region}` : ''}${benefits.length ? `, Benefits: ${benefits.join(', ')}` : ''}.

URSPRUNGSSPRUCH: "${spruch.trim()}"

AUFGABE: Liefere 3 verbesserte Varianten desselben Spruchs — jede schärfer nach der Kontrast-Mechanik oben, in VERSALIEN, mit klarem Wechsel-Schmerz + Gegenpol. Behalte die Grund-Botschaft, aber mach sie scroll-stoppender. Wenn der Original-Schmerz unklar ist, wähle den plausibelsten aus den Stellendaten.

Antworte NUR mit JSON, keine Markdown-Backticks:
{ "varianten": ["VARIANTE 1", "VARIANTE 2", "VARIANTE 3"] }`;

  const data = await callClaudeWithRetry({
    model: CLAUDE_MODEL,
    max_tokens: 500,
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

// Farb-Anweisung wenn eine STILVORLAGE genutzt wird: Layout/Komposition/Typografie
// kommen aus der Vorlage, die FARBEN aber aus der Kunden-CI (nicht aus dem
// Referenzbild) — außer farben_fix ist gesetzt (dann bleibt die Vorlagenfarbe).
function buildStilFarbAnweisung({ kunde, hasLogo, farbenFix, hatStilbeispiel }) {
  const quelle = hatStilbeispiel ? 'des Referenzbilds' : 'der Stilvorlage';
  if (farbenFix) {
    return `FARBEN: Behalte die Farbgebung ${quelle} bewusst bei — die Farbe ist hier fester Teil des Stils. (Das echte Kundenlogo wird separat als Overlay oben rechts eingefügt.)`;
  }
  const f = kunde?.farben;
  const werte = [];
  if (f?.primaer)   werte.push(`Primär ${f.primaer}`);
  if (f?.sekundaer) werte.push(`Sekundär ${f.sekundaer}`);
  if (f?.akzent)    werte.push(`Akzent ${f.akzent}`);
  const kopf = `FARBEN — WICHTIG: Übernimm ${quelle} NUR Layout, Komposition, Typografie-Charakter und grafische Stilelemente (z. B. Pinselstrich-Optik, Block-Anordnung). `;
  const kontrast = ` Achte auf ausreichenden Kontrast für Textlesbarkeit (ggf. Weiß oder Schwarz als Textfarbe auf den CI-Flächen).`;
  if (werte.length) {
    return `${kopf}Ersetze SÄMTLICHE Farben ${quelle} durch diese Kundenfarben: ${werte.join(', ')}.${kontrast}`;
  }
  if (hasLogo) {
    return `${kopf}Der Kunde hat keine Markenfarben hinterlegt: Leite die Farbpalette aus dem mitgelieferten Firmenlogo ab (dominante Logo-Farbe + neutrale Ergänzung) und ersetze damit SÄMTLICHE Farben ${quelle}.${kontrast}`;
  }
  return `${kopf}Nutze NICHT die Farben ${quelle}. Verwende stattdessen ein neutrales Schema: Anthrazit/Dunkelgrau als Basis, Weiß für Text, EINE kräftige Akzentfarbe.${kontrast}`;
}

// Sorgt für korrekte Stellendarstellung mit Geschlechtskürzel: "Bauhelfer" → "Bauhelfer (m/w/d)"
function stelleDisplay(stelle) {
  if (!stelle) return 'Mitarbeiter:in (m/w/d)';
  if (/\([mwfd][\/\\mwfd\s\-]+\)/i.test(stelle)) return stelle.trim();
  return `${stelle.trim()} (m/w/d)`;
}

// Stellenname OHNE (m/w/d) — für den großen Hauptbalken
function stelleClean(stelle) {
  if (!stelle) return 'Mitarbeiter:in';
  return stelle.replace(/\s*\([mwfd][\/\\mwfd\s\-]+\)\s*$/i, '').trim();
}

// Vollzeit/Teilzeit-Label aus job.formdata_komplett.anstellungsart oder job.anstellungsart
function arbeitszeitLabel(job) {
  const raw = String(job?.formdata_komplett?.anstellungsart || job?.anstellungsart || '').toLowerCase().trim();
  if (raw === 'vollzeit' || raw === 'full' || raw === 'fulltime' || raw === 'voll') return 'Vollzeit';
  if (raw === 'teilzeit' || raw === 'part' || raw === 'parttime' || raw === 'teil') return 'Teilzeit';
  if (raw === 'beide' || raw === 'beides' || raw === 'voll/teil' || raw === 'both') return 'Vollzeit/Teilzeit';
  if (raw === 'ausbildung' || raw === 'azubi') return 'Ausbildung';
  if (raw === 'minijob' || raw === '450€' || raw === 'geringfügig') return 'Minijob';
  return null; // unbekannt/leer → Meta-Leiste ohne Arbeitszeit
}

// Baut den Inhalt der Meta-Leiste: 📍 Ort | Arbeitszeit | (m/w/d)
function buildMetaLeiste(job) {
  const ort = cleanOrt(job?.region);
  const az = arbeitszeitLabel(job);
  const parts = [];
  if (ort) parts.push(`📍 ${ort}`);
  if (az)  parts.push(az);
  parts.push('(m/w/d)');
  return parts.join(' | ');
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

/**
 * Baut den FESTEN unteren Job-Block — gleiches Layout bei jedem Creative,
 * unser Wiedererkennungsmerkmal. Wird in beide Prompts (KI + Foto) eingesetzt.
 */
/**
 * Rendert den layout_prompt einer Stilvorlage mit den job-spezifischen
 * Werten. Ersetzt Platzhalter der Form {schluessel} — unbekannte bleiben
 * unangetastet, damit User-Fehler nicht die ganze Generierung sprengen.
 */
export function renderLayoutPrompt(template, ctx) {
  if (!template) return '';
  return String(template).replace(/\{(\w+)\}/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(ctx, key) ? String(ctx[key] ?? '') : m
  );
}

function buildLayoutCtx({ job, kunde, hasLogo, spruch, farbenFix = false }) {
  const firmenname = kunde?.firmenname || '';
  const benefits = pickBenefits(job);
  const benefitsListe = [...benefits.map(b => `"${b}"`), '"u.v.m."'].join(', ');
  const farbenHinweis = buildFarbenHinweis(kunde);
  // Bei farben_fix bleibt die Vorlagenfarbe der Stil → keine CI-Farb-Hints erzwingen.
  const hatFarben = !farbenFix && !!farbenHinweis;
  const stelleGross = stelleClean(job.stelle).toUpperCase();
  const metaLeiste = buildMetaLeiste(job);
  const hookAnweisung = spruch?.trim()
    ? `Verwende EXAKT diesen Wortlaut: "${spruch.trim()}". KEINEN eigenen Spruch erfinden — nutze GENAU diese Wörter. Mehrzeilig OK (2-3 Wörter pro Zeile)`
    : `Kurzer, emotionaler Recruiting-Spruch (max. 5-6 Wörter, 2-3 Wörter pro Zeile). KEIN "Wir suchen dich"-Klischee`;
  const logoPlatzierung = hasLogo
    ? 'LOGO wird NACHTRÄGLICH per Code oben rechts eingefügt — den Bereich oben rechts (ca. 22% Breite × 18% Höhe) VÖLLIG FREI halten, kein Firmenname-Text im Bild'
    : `FIRMENNAME-SCHRIFTZUG dezent oben: "${firmenname}" als sauberer Text-Schriftzug, klein (max. 10% Bildhöhe). KEIN Logo-Element`;

  const farbenHinweisText = farbenFix
    ? 'Behalte die Farbgebung der Vorlage bei (die Farbe ist Teil des Stils).'
    : (farbenHinweis || 'Wähle 1–2 kräftige, zur Marke passende Akzentfarben; neutraler dunkler Grund.');

  return {
    stelle_gross:                             stelleGross,
    meta_leiste:                              metaLeiste,
    benefits_liste:                           benefitsListe,
    firmenname,
    hook_anweisung:                           hookAnweisung,
    logo_platzierung:                         logoPlatzierung,
    farben_hinweis:                           farbenHinweisText,
    meta_leiste_farbe_hinweis:                hatFarben
      ? 'der Markenfarbe als Hintergrund (kontrastreich)' : 'dunklem Hintergrund (#0a0a0a)',
    stellenbereich_farb_hinweis:              hatFarben
      ? 'in Markenfarbe als Hintergrund mit weißer/kontrastreicher Schrift' : 'in einer kräftigen Akzentfarbe (lime/orange/türkis) mit dunkler Schrift',
    stellenbereich_farb_hinweis_alternative:  hatFarben
      ? 'in Markenfarbe oder Anthrazit' : 'in Anthrazit',
  };
}

function buildFixerJobBlock({ stelleGross, metaLeiste, farben, slogan }) {
  return `═══════════════════════════════════════════════════════════════
FESTER UNTERER JOB-BLOCK (PFLICHT — IMMER GLEICHER AUFBAU, ca. unteres Drittel der Bildhöhe):
═══════════════════════════════════════════════════════════════

Der untere Bereich ist FEST strukturiert und MUSS in JEDEM Creative klar abgegrenzt sein. Aufbau von oben nach unten:

1. META-LEISTE (Pflicht, direkt über der Stellenbezeichnung):
   Eine abgerundete Box/Banner mit ${farben ? 'der Markenfarbe als Hintergrund (Pillenform, kontrastreich zum Bild)' : 'dunklem Hintergrund (#0a0a0a, Pillenform)'}.
   Inhalt EXAKT: "${metaLeiste}"
   — Pipe-Zeichen "|" als Trenner zwischen Ort, Arbeitszeit und (m/w/d). Gut lesbar, mittig oder linksbündig, weiße Schrift, mittlere Schriftgröße.

2. STELLENBEZEICHNUNG (Pflicht, eigener visueller Bereich GANZ UNTEN):
   "${stelleGross}" — das GRÖSSTE Text-Element im gesamten Creative.
   Layout-Optionen (du wählst eine):
   ${farben
     ? '(a) Vollbreite-Balken in Markenfarbe als Hintergrund mit weißer/kontrastreicher Schrift, ODER (b) heller/weißer Vollbreite-Balken mit Markenfarben-Schrift.'
     : '(a) Vollbreite-Balken in einer kräftigen Akzentfarbe (lime, orange, türkis) mit dunkler Schrift, ODER (b) heller/weißer Vollbreite-Balken mit dunkler Schrift und farbiger Akzent-Linie.'}
   Die Berufsbezeichnung in GROSSBUCHSTABEN, FETT, formatfüllend (so groß wie möglich, dass sie noch in die Breite passt).
   Mehrwortige Bezeichnungen ggf. mit Bindestrich umbrochen (z.B. "MALER-\\nUND LACKIERER").${slogan ? `

3. SLOGAN klein darunter im selben Bereich:
   "${slogan}" — kleinere, dünnere Schrift; EIN Wort darin in Markenfarbe hervorgehoben.` : ''}

Der untere Job-Block ist optisch klar vom oberen Bild abgegrenzt (entweder durch farbigen Balken, abgesetzte Kante, oder hellem Vollbreite-Block — KEIN nahtloser Übergang).`;
}

// Erkennt, ob ein Text (Motiv / Änderungswunsch) das Firmenlogo IM Motiv
// verlangt — also auf Kleidung/Fahrzeug, wo die KI es tatsaechlich rendern muss
// (nicht das pixelgenaue Eck-Logo, das per Sharp-Overlay kommt). Verlangt einen
// Logo-Begriff UND einen Kleidungs-/Fahrzeug-Begriff -> hohe Praezision.
export function willLogoImMotiv(text = '') {
  const t = String(text).toLowerCase();
  const hatLogo = /\b(logo|firmenlogo|signet|markenzeichen|branding)\b/.test(t);
  const hatTraeger = /(shirt|t-?shirt|hemd|jacke|arbeitskleidung|arbeitsjacke|kleidung|weste|pullover|hoodie|overall|latzhose|montur|kittel|schürze|schuerze|cap|mütze|muetze|fahrzeug|auto|transporter|wagen|van|lkw|truck)/.test(t);
  return hatLogo && hatTraeger;
}

// Prompt-Baustein, wenn das Logo IM Motiv (auf Kleidung/Fahrzeug) erscheinen soll.
// Zwei Modi: 'voll' (Default) = komplettes Logo inkl. Schriftzug; 'icon' = nur
// das Bildzeichen (dezenter Brust-Stick). Beide halten den Eck-Bereich frei.
const LOGO_ECK_FREI =
  `WICHTIG: Der Bereich oben rechts (ca. 22% Breite × 18% Höhe, ~3% Abstand zum Rand) bleibt trotzdem FREI — ` +
  `dort wird nachträglich per Code das exakte Eck-Logo eingefügt; platziere DORT kein Logo.`;

const LOGO_KLEIDUNG_HINWEIS_VOLL =
  `Das mitgelieferte Logo [Datei "firmenlogo"] ist das echte, VOLLSTÄNDIGE Firmenlogo. Platziere dieses Logo ` +
  `VOLLSTÄNDIG und unverändert — INKLUSIVE des Schriftzugs/Firmennamens, exakt wie im beigefügten Logo-Bild. ` +
  `Verwende NICHT nur das Bildzeichen/Icon. Das GESAMTE Logo (Grafik + Schriftzug) erscheint als EIN ` +
  `zusammenhängender Aufdruck/Stick auf der Arbeitskleidung der Person (bevorzugt Brust oder Rücken), ` +
  `realistisch in Perspektive und Faltenwurf des Stoffs eingepasst. Übernimm den Schriftzug 1:1 aus dem ` +
  `Logo-Bild — erfinde keinen eigenen Text und ändere die Schreibweise nicht. Platziere das Logo groß genug, ` +
  `dass der Schriftzug klar lesbar bleibt (Brustbereich, kein Mini-Stick). ${LOGO_ECK_FREI}`;

const LOGO_KLEIDUNG_HINWEIS_ICON =
  `Das mitgelieferte Logo [Datei "firmenlogo"] ist das echte Firmenlogo. Platziere daraus NUR das ` +
  `Bildzeichen/Icon (die reine Grafik OHNE Schriftzug) dezent und realistisch als kleinen Stick/Aufdruck auf ` +
  `der Arbeitskleidung der Person (Brust oder Ärmel), an Perspektive, Faltenwurf und Stoff angepasst. Erfinde ` +
  `KEINEN Text und schreibe NICHT den Firmennamen als Schrift — nutze ausschließlich das Bildzeichen aus dem ` +
  `Referenzbild. ${LOGO_ECK_FREI}`;

// modus: 'voll' (Default) | 'icon'
const logoKleidungHinweis = (modus) => (modus === 'icon' ? LOGO_KLEIDUNG_HINWEIS_ICON : LOGO_KLEIDUNG_HINWEIS_VOLL);

// ── Zentrale Layout-Invarianten ──
// Kern-Regeln, die UNABHÄNGIG von Stilvorlage/Motiv/Logo-Umschaltung IMMER gelten.
// Bewusst hier zentralisiert (nicht in einzelnen Prompt-Bausteinen verteilt), damit
// künftige Prompt-Umbauten sie nicht versehentlich verdrängen (siehe Ebenen-Regression).
// Text nie über das Gesicht — gilt in JEDEM Modus.
const TEXT_GESICHT_REGEL = 'Lege Text, Banner oder Grafik-Elemente NIEMALS über das Gesicht der Person.';
// Tiefen-/Ebeneneffekt — gilt, wenn eine Person das Hauptmotiv ist (KI-Modus).
const EBENEN_TIEFE_REGEL =
  'EBENEN & TIEFE (PFLICHT): Die Person steht klar im VORDERGRUND und überlappt die große Headline/Typografie ' +
  'leicht (Kopf und Schulter liegen VOR dem Text) — Tiefeneffekt wie bei hochwertigen Social-Ads. Der Text/das ' +
  'Banner liegt HINTER der Person, nicht davor. ' + TEXT_GESICHT_REGEL;

// Prompt für Modus "ki" — komplett neues Bild generieren, optional mit Person als Vorlage.
// Hinweis für eine hochgeladene Stil-Vorlage (referenzbild_nutzen). Das Bild wird
// als LETZTES Referenzbild in image[] mitgeschickt.
const STIL_VORLAGE_HINWEIS = `STIL-VORLAGE: Das ZULETZT beigefügte Bild (Dateiname "stilbeispiel") ist eine STIL-VORLAGE. Übernimm dessen Layout-Aufbau, Text-Anordnung, Gestaltungsprinzipien und visuelle Sprache — aber mit den Inhalten, Farben und dem Logo DIESES Kunden. Kopiere KEINE Texte, Personen oder Logos aus der Vorlage.`;

function buildPromptKI({ job, kunde, motiv, format, hasLogo, person, spruch, stilvorlage, hatStilbeispiel = false, logoAufKleidung = false, logoModus = 'voll' }) {
  const stelle = stelleDisplay(job.stelle);
  const ort = cleanOrt(job.region);
  const branche = BRANCHE_LABEL[kunde?.branche] || kunde?.branche || '';
  const firmenname = kunde?.firmenname || '';
  const benefits = pickBenefits(job);
  const benefitListe = [...benefits.map(b => `"${b}"`), '"u.v.m."'].join(', ');
  const orientation = format === 'story' ? 'hochkant (2:3, geeignet für Stories/Reels)' : 'quadratisch (1:1, geeignet für Feed-Posts)';
  const farben = buildFarbenHinweis(kunde);
  // Mit Stilvorlage: Farben aus der Kunden-CI erzwingen (nicht aus dem Referenzbild),
  // außer farben_fix ist gesetzt. Ohne Stilvorlage: bisheriger Markenfarben-Hinweis.
  const farbenFix = !!stilvorlage?.farben_fix;
  const farbBlock = stilvorlage
    ? buildStilFarbAnweisung({ kunde, hasLogo, farbenFix, hatStilbeispiel })
    : farben;

  const refHinweis = [];
  const LOGO_FREI_HINWEIS = `KRITISCH — LOGO-REGEL: Zeichne im gesamten Bild KEIN Logo, KEIN Firmenlogo, KEIN Signet, KEIN Markenzeichen, KEINEN Firmenname-Text, KEINE Wortmarke, KEINE Buchstaben-Grafik, die an ein Logo erinnert. Das echte Original-Logo wird nachträglich per Code oben rechts als Overlay eingefügt. Halte im Bereich oben rechts (ca. 22% Breite × 18% Höhe, mit ~3% Abstand zum Rand) einen ruhigen, weitgehend flächigen Bereich frei (keine Gesichter, keine wichtigen Details, keine Text-Elemente) — der Bereich darf farblich Teil der Szene sein, aber ohne kritische Bildinhalte. Farb-Balance darf sich am mitgelieferten Logo orientieren, das Logo selbst darf NIRGENDS ins Bild.`;
  // Logo-Anweisung: entweder "nur Farb-Referenz, nie ins Bild" (Default) oder
  // "platziere das echte Logo auf der Kleidung" (logoAufKleidung).
  const logoRefText = logoAufKleidung ? logoKleidungHinweis(logoModus)
    : `NUR als Farb-/Stil-Referenz. VERWENDE DIESES BILD NICHT als Person, NICHT als Hintergrund, NICHT als Bildelement. ${LOGO_FREI_HINWEIS}`;
  if (hasLogo && person) {
    refHinweis.push(
      `MITGELIEFERTE BILDER (in dieser Reihenfolge):`,
      `[BILD 1 — DATEINAME "firmenlogo"] = FIRMENLOGO. ${logoRefText}`,
      `[BILD 2 — DATEINAME "person"] = HAUPTMOTIV. Foto einer realen Person${person.beschreibung ? ` (Beschreibung: "${person.beschreibung}")` : ''}. DIESE Person ist die Hauptfigur des Creatives. Übernimm Gesichtszüge, Hauttyp, Haarfarbe, Frisur und Statur aus diesem Foto und stelle GENAU DIESE Person in der unten beschriebenen Szene dar — sie muss als dieselbe Person erkennbar bleiben. Kleidung darf der neuen Tätigkeit angepasst werden, das Gesicht NICHT.`,
    );
  } else if (hasLogo) {
    refHinweis.push(`MITGELIEFERTES BILD = FIRMENLOGO. ${logoRefText}`);
  } else if (person) {
    refHinweis.push(`MITGELIEFERTES BILD = HAUPTMOTIV. Foto einer realen Person${person.beschreibung ? ` (Beschreibung: "${person.beschreibung}")` : ''}. Übernimm Gesichtszüge, Hauttyp, Haarfarbe, Frisur und Statur und stelle GENAU DIESE Person in der unten beschriebenen Szene dar — sie muss als dieselbe Person erkennbar bleiben.`);
  }

  const stelleGross = stelleClean(job.stelle).toUpperCase();
  const metaLeiste = buildMetaLeiste(job);

  // Layout-Block: entweder aus Stilvorlage rendern, sonst Default (Job-Block unten)
  const layoutBlock = stilvorlage?.layout_prompt
    ? renderLayoutPrompt(stilvorlage.layout_prompt, buildLayoutCtx({ job, kunde, hasLogo, spruch, farbenFix }))
    : `${buildFixerJobBlock({ stelleGross, metaLeiste, farben: !!farben })}

═══════════════════════════════════════════════════════════════
FLEXIBLER BEREICH OBEN (die oberen ca. 65% der Bildfläche — Stil & Anordnung darfst du variieren):
═══════════════════════════════════════════════════════════════

• HOOK / HAUPTSPRUCH (Position frei — irgendwo im oberen/mittleren Bereich):
  ${spruch?.trim()
    ? `Verwende EXAKT diesen Wortlaut: "${spruch.trim()}". KEINEN eigenen Spruch erfinden — nutze GENAU diese Wörter. GROSS, fett, sofort fesselnd; gerne auf einem PINSELSTRICH-Banner in Markenfarbe gesetzt (ungleichmäßige Kanten, organischer Look). Mehrzeilig OK (2-3 Wörter pro Zeile).`
    : 'Kurzer, emotionaler Recruiting-Spruch (max. 5-6 Wörter, 2-3 Wörter pro Zeile). Setze ihn gerne auf einen PINSELSTRICH-Banner in Markenfarbe (ungleichmäßige Kanten, organischer Look). KEIN "Wir suchen dich"-Klischee.'}

• BENEFIT-BADGES (Position frei — z.B. seitlich, in der oberen Hälfte oder neben der Person):
  3-4 RUNDE Icon-Badges (Kreise, ca. 60-90px Durchmesser) mit jeweils einem Icon + kurzer Beschriftung darunter: ${benefitListe}
  Kompakte Begriffe wie "Firmenwagen", "Tankkarte", "30 Tage Urlaub" — keine Sätze. Anordnung frei (z.B. vertikal links, horizontal oben, etc.)

• ${hasLogo
    ? `LOGO wird NACHTRÄGLICH oben rechts eingefügt — dort NICHTS platzieren, den Bereich freilassen (ca. 20% Breite × 15% Höhe). KEIN Firmenname-Text im Bild.`
    : `FIRMENNAME-SCHRIFTZUG dezent oben oder im Header-Bereich: "${firmenname}" als sauberer Text-Schriftzug, klein (max. 10% Bildhöhe). KEIN Logo-Element.`}

• Person/Hauptmotiv im VORDERGRUND (Seite/Mitte frei wählbar) — sie überlappt die Headline leicht (siehe Ebenen-Regel unten)
• Pinselstrich- oder Farbspritzer-Elemente in Markenfarbe als gestalterische Akzente (organisch, nicht überladen)`;

  return `Erstelle ein hochwertiges Social Media Recruiting Ad ${orientation} im Stil einer professionellen Recruiting-Agentur.

${refHinweis.length ? refHinweis.join('\n') + '\n\n' : ''}${hatStilbeispiel ? STIL_VORLAGE_HINWEIS + '\n\n' : ''}${farbBlock ? farbBlock + '\n\n' : ''}BILDMOTIV (Hintergrund / Szene):
${motiv}
- Fotorealistisch, cinematic Look, warme Farben, leichter Bokeh-Effekt
- Branche: ${branche}
- Authentisch, Person(en) selbstbewusst und zufrieden — keine gestellten Stock-Fotos${person ? '\n- Die Person aus dem Referenzbild ist die Hauptfigur in dieser Szene.' : ''}

${layoutBlock}

DESIGN-REGELN:
${person ? `- ${EBENEN_TIEFE_REGEL}\n` : ''}- HIERARCHIE der Größen: STELLENBEZEICHNUNG (am größten, formatfüllend) > Hook (groß) > Benefits (kompakt) > Meta-Leiste & Logo (dezent)
- ${stilvorlage && !farbenFix ? 'Farben streng nach Kunden-CI (siehe oben) — NICHT die Farben der Vorlage übernehmen.' : farben ? 'Markenfarben konsequent.' : 'Wähle 1-2 kräftige Akzentfarben (z.B. orange/türkis/rot).'}
- Schrift modern, sehr lesbar. Stellenbezeichnung in fetten Großbuchstaben.
- Keine QR-Codes, keine Rahmen ums ganze Bild
- Muss auf dem Handy sofort ins Auge springen und Scroll-Stop erzeugen`;
}

// Prompt für Modus "foto" — Foto als Hintergrund unverändert übernehmen, nur Overlay hinzufügen.
function buildPromptFoto({ job, kunde, format, hasLogo, spruch, stilvorlage, hatStilbeispiel = false, logoAufKleidung = false, logoModus = 'voll' }) {
  const stelle = stelleDisplay(job.stelle);
  const ort = cleanOrt(job.region);
  const firmenname = kunde?.firmenname || '';
  const benefits = pickBenefits(job);
  const benefitListe = [...benefits.map(b => `"${b}"`), '"u.v.m."'].join(', ');
  const orientation = format === 'story' ? 'hochkant (2:3, geeignet für Stories/Reels)' : 'quadratisch (1:1, geeignet für Feed-Posts)';
  const farben = buildFarbenHinweis(kunde);
  const farbenFix = !!stilvorlage?.farben_fix;
  const farbBlock = stilvorlage
    ? buildStilFarbAnweisung({ kunde, hasLogo, farbenFix, hatStilbeispiel })
    : farben;

  const logoZeile = logoAufKleidung
    ? `[BILD 1 — DATEINAME "firmenlogo"] = FIRMENLOGO. ${logoKleidungHinweis(logoModus)}`
    : `[BILD 1 — DATEINAME "firmenlogo"] = FIRMENLOGO. NUR als Farb-/Stil-Referenz. Das Logo wird NIEMALS ins Bild gezeichnet — es wird nachträglich per Code als Overlay oben rechts eingefügt. Nutze das Bild nur, um die Markenfarbe zu erkennen.`;
  const refLines = hasLogo
    ? `MITGELIEFERTE BILDER (in dieser Reihenfolge):
${logoZeile}
[BILD 2 — DATEINAME "hintergrundfoto"] = HINTERGRUND. Übernimm dieses Foto EXAKT als Hintergrund, ohne es zu verändern: keine Personen austauschen, keine Komposition ändern, keine Farben verfälschen, keine Filter, kein neuer Bildstil. Es bleibt der echte, originale Foto-Look.`
    : `MITGELIEFERTES BILD = HINTERGRUND. Übernimm dieses Foto EXAKT als Hintergrund, ohne es zu verändern: keine Personen austauschen, keine Komposition ändern, keine Farben verfälschen, keine Filter, kein neuer Bildstil. Es bleibt der echte, originale Foto-Look.`;

  const stelleGross = stelleClean(job.stelle).toUpperCase();
  const metaLeiste = buildMetaLeiste(job);

  const layoutBlock = stilvorlage?.layout_prompt
    ? renderLayoutPrompt(stilvorlage.layout_prompt, buildLayoutCtx({ job, kunde, hasLogo, spruch, farbenFix }))
    : `${buildFixerJobBlock({ stelleGross, metaLeiste, farben: !!farben })}

═══════════════════════════════════════════════════════════════
FLEXIBLER BEREICH OBEN (ca. obere 65% — du wählst Stil & Anordnung der Overlay-Elemente):
═══════════════════════════════════════════════════════════════

• HOOK / HAUPTSPRUCH: ${spruch?.trim()
    ? `Verwende EXAKT diesen Wortlaut: "${spruch.trim()}". KEINEN eigenen Spruch erfinden — nutze GENAU diese Wörter. GROSS, fett, sofort fesselnd.`
    : 'Kurzer Recruiting-Spruch (max. 5-6 Wörter). KEIN "Wir suchen dich"-Klischee.'}

• BENEFIT-BADGES: 3-4 RUNDE Icon-Badges (Kreise, ca. 60-90px) mit Icon + kurzer Beschriftung: ${benefitListe}

• ${hasLogo
    ? `LOGO wird NACHTRÄGLICH oben rechts als Overlay eingefügt — der Bereich oben rechts (ca. 22% Breite × 15% Höhe) bleibt VÖLLIG FREI. Zeichne dort NICHTS.`
    : `FIRMENNAME-SCHRIFTZUG dezent oben: "${firmenname}" als sauberer Text-Schriftzug, klein. KEIN Logo-Element.`}

• Pinselstrich- oder Farbspritzer-Akzente in Markenfarbe (organisch, nicht überladen)`;

  return `Erstelle ein professionelles Recruiting-Ad-Overlay ${orientation} im Stil einer hochwertigen Recruiting-Agentur.

${refLines}
${hatStilbeispiel ? '\n' + STIL_VORLAGE_HINWEIS + '\n' : ''}
${farbBlock ? farbBlock + '\n\n' : ''}Falls das Hintergrundfoto nicht im Zielformat ist, beschneide es respektvoll (Person/wesentliche Bildelemente sichtbar lassen).

${layoutBlock}

DESIGN-REGELN:
- HIERARCHIE der Größen: STELLENBEZEICHNUNG (formatfüllend im unteren Job-Block) > Hook (groß) > Benefits (kompakt) > Meta-Leiste & Logo (dezent)
- Dunkler halbtransparenter Gradient/Schatten hinter Overlay-Texten falls nötig für Lesbarkeit — das Foto bleibt der Held
- ${TEXT_GESICHT_REGEL} Große Text-Elemente in ruhige Bildzonen (Himmel, Wand, unscharfer Hintergrund), nicht auf Personen/Gesichter.
- ${stilvorlage && !farbenFix ? 'Farben streng nach Kunden-CI (siehe oben) — NICHT die Farben der Vorlage übernehmen.' : farben ? 'Markenfarben konsequent — Pinselstriche, Meta-Leiste, Stellen-Bereich.' : 'Wähle 1-2 kräftige Akzentfarben (orange/türkis/rot) für Pinselstriche und Stellen-Bereich.'}
- Schrift modern, sehr lesbar. Stellenbezeichnung in fetten Großbuchstaben.
- Keine zusätzlichen Filter aufs Foto, keine Verfremdung
- Keine QR-Codes, keine Rahmen ums ganze Bild
- Wirkung: echtes Foto = Held, Overlay-Job-Block macht klar "hier wird XY gesucht in der Region"`;
}

// Wrapper — wählt den passenden Prompt anhand des Projekttyps und Modus.
// Projekttyp „neukundengewinnung" → Lead-Gen-Layout (Produkt/Ergebnis im Fokus,
// CTA „Kostenloses Angebot", keine Stellenbezeichnung). Sonst Recruiting.
export function buildCreativePrompt({ job, kunde, motiv, format, mode = 'ki', hasLogo, person, spruch, stilvorlage, hatStilbeispiel = false, logoAufKleidung = false, logoModus = 'voll' }) {
  if (job?.projekttyp === 'neukundengewinnung') {
    return buildPromptNeukunden({ job, kunde, motiv, format, mode, hasLogo, person, spruch });
  }
  if (mode === 'foto') return buildPromptFoto({ job, kunde, format, hasLogo, spruch, stilvorlage, hatStilbeispiel, logoAufKleidung, logoModus });
  return buildPromptKI({ job, kunde, motiv, format, hasLogo, person, spruch, stilvorlage, hatStilbeispiel, logoAufKleidung, logoModus });
}

// Prompt für Neukundengewinnung (Lead-Gen-Ad).
function buildPromptNeukunden({ job, kunde, motiv, format, mode, hasLogo, person, spruch }) {
  const nk = job?.neukunden_daten || {};
  const produkt   = (nk.produkt || job?.stelle || 'Angebot').toString().trim();
  const produktGross = produkt.toUpperCase();
  const zielgruppe   = (nk.zielgruppe || '').toString().trim();
  const region       = (nk.einzugsgebiet || job?.region || '').toString().trim();
  const vorteile     = Array.isArray(nk.vorteile) ? nk.vorteile.filter(Boolean).slice(0, 4) : [];
  const unterschied  = (nk.unterschied || '').toString().trim();
  const firmenname   = kunde?.firmenname || '';
  const orientation  = format === 'story' ? 'hochkant (2:3, geeignet für Stories/Reels)' : 'quadratisch (1:1, geeignet für Feed-Posts)';
  const farben = buildFarbenHinweis(kunde);

  const refHinweis = [];
  const LOGO_FREI = `KRITISCH — LOGO-REGEL: Zeichne im gesamten Bild KEIN Logo, KEIN Firmenlogo, KEIN Signet, KEIN Markenzeichen, KEINEN Firmenname-Text, KEINE Wortmarke. Das echte Original-Logo wird nachträglich per Code oben rechts als Overlay eingefügt. Halte oben rechts (ca. 22% Breite × 18% Höhe, mit ~3% Abstand zum Rand) einen ruhigen Bereich frei (keine wichtigen Details, keine Text-Elemente).`;
  if (mode === 'foto') {
    if (hasLogo) {
      refHinweis.push(`MITGELIEFERTE BILDER:\n[BILD 1 — DATEINAME "firmenlogo"] = FIRMENLOGO. NUR als Farb-Referenz. ${LOGO_FREI}\n[BILD 2 — DATEINAME "hintergrundfoto"] = HINTERGRUND. Übernimm EXAKT als Hintergrund, ohne Verfremdung.`);
    } else {
      refHinweis.push(`MITGELIEFERTES BILD = HINTERGRUND. Übernimm EXAKT als Hintergrund, ohne Verfremdung.`);
    }
  } else {
    if (hasLogo && person) {
      refHinweis.push(
        `MITGELIEFERTE BILDER:`,
        `[BILD 1 — DATEINAME "firmenlogo"] = FIRMENLOGO. NUR als Farb-/Stil-Referenz. ${LOGO_FREI}`,
        `[BILD 2 — DATEINAME "produkt"] = PRODUKT- oder KUNDEN-REFERENZ. Zeigt das Produkt / eine Anwendungssituation. Nutze es als visuelles Herzstück des Creatives — respektiere die realen Proportionen und Details.`,
      );
    } else if (hasLogo) {
      refHinweis.push(`MITGELIEFERTES BILD = FIRMENLOGO. NUR als Farb-Referenz. ${LOGO_FREI}`);
    } else if (person) {
      refHinweis.push(`MITGELIEFERTES BILD = PRODUKT-REFERENZ. Nutze es als visuelles Herzstück (reale Details, keine Verfremdung).`);
    }
  }

  const vorteileZeile = vorteile.length > 0
    ? vorteile.map(v => `"${v}"`).join(', ')
    : '"schnelle Umsetzung", "individuelle Beratung", "Top-Qualität", "u.v.m."';

  return `Erstelle eine hochwertige Social Media Lead-Gen-Anzeige ${orientation} — professionelles Recruiting-Agentur-Design (Pinselstrich-/Spritzer-Elemente in Markenfarbe), aber inhaltlich auf KAUFINTERESSENTEN, nicht Bewerber.

${refHinweis.length ? refHinweis.join('\n') + '\n\n' : ''}${farben ? farben + '\n\n' : ''}BILDMOTIV / HINTERGRUND:
${motiv || (mode === 'foto' ? 'Verwende das mitgelieferte Foto als Hintergrund.' : 'Realistisch und ansprechend, Fokus auf Produkt/Anwendung — z. B. echte Anwendungssituation, glückliche Kunden, Ergebnis.')}
${zielgruppe ? `\nZielgruppe: ${zielgruppe}` : ''}${unterschied ? `\nUnterscheidungsmerkmal: ${unterschied}` : ''}

═══════════════════════════════════════════════════════════════
LAYOUT: FESTER UNTERER BEREICH (Angebot-Block) + FLEXIBLER OBERER BEREICH
═══════════════════════════════════════════════════════════════

FESTER UNTERER BEREICH (ca. 25% der Bildhöhe):
• PRODUKT-/ANGEBOT-BEZEICHNUNG in fetten Großbuchstaben (formatfüllend): "${produktGross}"
${region ? `• Meta-Leiste darunter: "📍 ${region}"` : ''}
• Große CTA-Fläche: "Jetzt kostenloses Angebot sichern" ODER "Jetzt kostenlos anfragen" — als aufmerksamkeitsstarker Button in Markenfarbe, klare Kanten, sehr lesbar
• Farbig hinterlegt in Markenfarbe (bzw. gewählter Akzentfarbe), Text in Kontrastfarbe

FLEXIBLER BEREICH OBEN (die oberen ca. 60% — Stil & Anordnung darfst du variieren):

• HOOK / HAUPTSPRUCH (Position frei):
  ${spruch?.trim()
    ? `Verwende EXAKT diesen Wortlaut: "${spruch.trim()}". KEINEN eigenen Spruch erfinden. GROSS, fett, sofort neugierig machend; gerne auf einem PINSELSTRICH-Banner in Markenfarbe. Mehrzeilig OK.`
    : `Kurzer, emotionaler Hook (max. 5-6 Wörter), der Nutzen oder Ergebnis für den Kunden verspricht. KEIN "Wir suchen dich"-Klischee. Beispiel-Muster: Frage-Hook, Ergebnis-Versprechen, Neugier-Gap.`}

• 3-4 PRODUKT-VORTEILE als runde Icon-Badges (Kreise, ca. 60-90px) mit Icon + kompakter Beschriftung: ${vorteileZeile}
  Kompakte Begriffe — keine Sätze. Anordnung frei.

• Logo-Bereich oben rechts bleibt FREI (wird per Code als Overlay ergänzt). KEIN Firmenname-Text.

• Produkt/Motiv-Anordnung frei (links, rechts, mittig oder freigestellt)
• Pinselstrich- oder Farbspritzer-Elemente in Markenfarbe als gestalterische Akzente

DESIGN-REGELN:
- HIERARCHIE der Größen: ANGEBOT-BEZEICHNUNG (am größten, formatfüllend im unteren Block) > CTA > Hook > Vorteile > Meta-Leiste
- ${farben ? 'Markenfarben konsequent — Pinselstriche, Meta-Leiste, CTA.' : 'Wähle 1-2 kräftige Akzentfarben (z. B. orange/türkis/rot) für Pinselstriche, Meta-Leiste und CTA.'}
- Schrift modern, sehr lesbar
- Keine QR-Codes, keine Rahmen ums Bild
- Firmenname "${firmenname}" darf im unteren Bereich als kleiner Vermerk erscheinen (dezent, max. 8% Bildhöhe)
- Muss am Handy sofort Scroll-Stop erzeugen und Kaufinteresse triggern (Angebot / Vorteil / CTA klar erkennbar)`;
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
//
// Jedes Bild wird direkt hier fuer OpenAI normalisiert (HEIC/CMYK/zu gross ->
// sRGB-PNG, max 2048px). Das ist bewusst der einzige Ort dafuer: Logo, Foto-
// Overlay, Regenerate und Varianten laufen alle ueber diese Funktion.
//
// Zwei Fehlerarten, bewusst unterschiedlich behandelt:
//  - URL nicht erreichbar (verwaiste Storage-Referenz) -> ueberspringen, wie bisher.
//  - Bild da, aber unlesbar -> UnsupportedImageError hochreichen. Ein defektes
//    Logo darf nicht dazu fuehren, dass stillschweigend ohne Logo generiert wird.
async function loadReferenceImages(refs) {
  const out = [];
  for (const ref of refs) {
    if (!ref?.url) continue;
    let roh;
    try {
      roh = await fetchAsBuffer(ref.url);
    } catch (err) {
      // Nicht erreichbar -> wie bisher ueberspringen (kein Nutzerfehler).
      console.warn(`[ref-fetch] ${ref.url}: ${err.message}`);
      continue;
    }
    const label = ref.isLogo ? 'Firmenlogo' : (ref.name || 'Referenzbild');
    const norm = await normalizeImageForOpenAI(roh.buffer, { label });
    if (roh.contentType !== norm.contentType) {
      console.log(`[ref-normalize] ${label}: ${roh.contentType} -> ${norm.contentType}`);
    }
    out.push({
      buffer: norm.buffer,
      contentType: norm.contentType,
      ext: norm.ext,
      name: ref.name || 'ref',
      isLogo: !!ref.isLogo,
      isStyle: !!ref.isStyle,
    });
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
export async function generateOneCreative({ job, kunde, motiv, format, mode = 'ki', referenceImages = [], spruch, stilvorlage, logoAufKleidung = false, logoModus = 'voll' }) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY nicht gesetzt.');
  const size = FORMAT_SIZE[format];
  if (!size) throw new Error(`Unbekanntes Format: ${format}`);
  if (mode === 'foto' && !referenceImages.some(r => !r.isLogo && !r.isStyle)) {
    throw new Error('Modus "foto" benötigt ein Hintergrund-Foto.');
  }

  const refs = await loadReferenceImages(referenceImages);
  const hasLogo = !!referenceImages[0]?.isLogo;
  const person = referenceImages.find(r => !r.isLogo && !r.isStyle) || null;
  const hatStilbeispiel = referenceImages.some(r => r.isStyle);
  // Logo-auf-Kleidung nur, wenn ueberhaupt ein Logo mitgeht.
  const logoImMotiv = logoAufKleidung && hasLogo;
  const prompt = buildCreativePrompt({ job, kunde, motiv, format, mode, hasLogo, person, spruch, stilvorlage, hatStilbeispiel, logoAufKleidung: logoImMotiv, logoModus });

  let response;
  if (refs.length > 0) {
    // Sortierung: Logo IMMER zuerst, Stil-Vorlage IMMER zuletzt (Prompt referenziert
    // das "zuletzt beigefügte Bild") — Person/Foto dazwischen.
    const rang = (r) => r.isLogo ? 0 : r.isStyle ? 2 : 1;
    refs.sort((a, b) => rang(a) - rang(b));
    console.log(`[imagegen] format=${format} mode=${mode} refs=[${refs.map(r => r.isLogo ? 'logo' : r.isStyle ? 'stil' : 'person').join(', ')}]`);

    const form = new FormData();
    form.append('model', 'gpt-image-2');
    form.append('prompt', prompt);
    form.append('size', size);
    form.append('quality', 'high');
    form.append('n', '1');
    refs.forEach((r) => {
      // Nach normalizeImageForOpenAI ist jedes Ref ein sRGB-PNG.
      const fileName = r.isStyle ? `stilbeispiel.${r.ext}`
        : r.isLogo ? `firmenlogo.${r.ext}`
        : (mode === 'foto' ? `hintergrundfoto.${r.ext}` : `person.${r.ext}`);
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

  let rawBuffer = Buffer.from(b64, 'base64');

  // Story-Format: gpt-image-2 liefert 1024x1536 (2:3). Meta Reels/Stories brauchen
  // 1080x1920 (9:16). Wir erweitern per Sharp mit "ambient extend" (Mirror+Blur),
  // damit das Bild reel-tauglich ist und Kling ein sauberes 9:16-Video macht.
  if (format === 'story') {
    try {
      rawBuffer = await extendTo9x16(rawBuffer);
    } catch (err) {
      console.warn(`[extend-9x16] fehlgeschlagen — behalte 2:3-Original: ${err.message}`);
    }
  }

  let finalBuffer = rawBuffer;
  let bildOhneLogoUrl = null;

  // Rohbild (ohne Overlay) separat speichern — Basis für spätere Logo-Neupositionierung.
  // Wenn kein Logo verwendet wird, ist bild_url == bild_ohne_logo_url; wir speichern
  // dann nur einmal, um Storage zu sparen.
  const logoRef = refs.find(r => r.isLogo);
  if (logoRef?.buffer) {
    const rawFilename = `${job.id}/raw-${format}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    try {
      bildOhneLogoUrl = await uploadToStorage(rawBuffer, rawFilename);
    } catch (err) {
      console.warn(`[imagegen] raw-upload fehlgeschlagen (nicht kritisch): ${err.message}`);
    }
    try {
      const transparentLogo = await ensureTransparentLogo(kunde, logoRef.buffer);
      finalBuffer = await composeLogoOverlay(rawBuffer, transparentLogo);
    } catch (err) {
      console.warn(`[logo-overlay] fehlgeschlagen — fahre ohne Overlay fort: ${err.message}`);
    }
  }

  const filename = `${job.id}/${format}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const bildUrl = await uploadToStorage(finalBuffer, filename);
  return { format, bildUrl, prompt, bildOhneLogoUrl };
}

/**
 * Liefert das transparente Logo des Kunden. Wenn `logo_transparent_url` fehlt
 * oder unerreichbar ist, wird es on-the-fly aus dem übergebenen Original-Buffer
 * präpariert und im Bucket „talentone-logos" abgelegt.
 */
async function ensureTransparentLogo(kunde, originalLogoBuffer) {
  if (kunde?.logo_transparent_url) {
    try {
      const { buffer } = await fetchAsBuffer(kunde.logo_transparent_url);
      return buffer;
    } catch (err) {
      console.warn(`[logo] logo_transparent_url unerreichbar — regeneriere: ${err.message}`);
    }
  }
  const transparent = await makeTransparent(originalLogoBuffer);
  if (kunde?.id) {
    try {
      const path = `${kunde.id}/transparent-${Date.now()}.png`;
      const publicUrl = await uploadBuffer({
        bucket: 'talentone-logos', path, buffer: transparent, contentType: 'image/png',
      });
      await supabase.from('talentone_kunden')
        .update({ logo_transparent_url: publicUrl })
        .eq('id', kunde.id);
    } catch (err) {
      console.warn(`[logo] transparent-Upload fehlgeschlagen (Overlay funktioniert trotzdem): ${err.message}`);
    }
  }
  return transparent;
}

// Generiert eine Variante in beiden Formaten (quadrat + story) parallel.
export async function generateVariant({ job, kunde, motiv, mode = 'ki', referenceImages = [], spruch, stilvorlage, logoAufKleidung = false, logoModus = 'voll' }) {
  const formats = ['quadrat', 'story'];
  const results = await Promise.allSettled(
    formats.map(format => generateOneCreative({ job, kunde, motiv, format, mode, referenceImages, spruch, stilvorlage, logoAufKleidung, logoModus })),
  );
  const ok = results.filter(r => r.status === 'fulfilled').map(r => r.value);
  const errors = results.filter(r => r.status === 'rejected').map(r => r.reason.message);
  return { ok, errors };
}

// Wendet einen freien Änderungswunsch auf einen Overlay-Hook an und gibt NUR
// den neuen Text zurueck. Fuer die gezielte Änderung von Overlay-Creatives
// (deterministisches HTML-Rerender mit geaendertem Text).
export async function neuerHookAusWunsch({ hook, wunsch }) {
  const prompt = `Du bearbeitest den Text-Hook einer Recruiting-Anzeige.

AKTUELLER HOOK: "${hook || '(leer)'}"
ÄNDERUNGSWUNSCH: ${wunsch}

Setze den Änderungswunsch um. Wenn er einen konkreten neuen Text vorgibt, nutze exakt diesen. Sonst passe den Hook sinngemäß an. Behalte die Kürze (max. 5-6 Wörter).

Antworte NUR mit JSON, keine Markdown-Backticks:
{ "hook": "der neue Text" }`;
  const data = await callClaudeWithRetry({ model: CLAUDE_MODEL, max_tokens: 200, messages: [{ role: 'user', content: prompt }] });
  const parsed = parseJsonContent(data);
  return (parsed?.hook || '').trim() || hook || '';
}

// Kanonische Zielgroesse je Format — damit editierte Bilder uniform zu den
// uebrigen Creatives sind (Logo-Position in % mappt dann identisch).
const FORMAT_PIXELS = { quadrat: [1024, 1024], story: [1080, 1920] };

// Baut den Edit-Prompt: NUR der Wunsch aendert sich, alles andere bleibt.
// Bei logoAufKleidung geht ein zweites Bild (das Firmenlogo) mit — dann wird die
// Anweisung ergaenzt, das echte Logo auf die Kleidung zu bringen.
function buildEditPrompt(wunsch, logoAufKleidung = false, logoModus = 'voll') {
  const basis =
    `Ändere an diesem Bild (BILD 1) AUSSCHLIESSLICH Folgendes: ${wunsch.trim()}\n\n` +
    `HARTE REGELN (nicht verletzen):\n` +
    `1. Komposition, Bildausschnitt, Personen, Gesichter, Farben, Beleuchtung und Layout bleiben exakt identisch zum Eingabebild.\n` +
    `2. ALLE übrigen Texte im Bild bleiben unverändert — gleicher Wortlaut, gleiche Schriftart, Größe und Position. Ändere NUR den oben genannten Text/Inhalt.\n` +
    `3. Füge nichts hinzu und entferne nichts außer der genannten Änderung.\n` +
    `4. Das Ergebnis muss ansonsten so nah wie möglich am Eingabebild bleiben.`;
  if (!logoAufKleidung) return basis;
  return basis + `\n\nZUSATZ — LOGO AUF KLEIDUNG: ${logoKleidungHinweis(logoModus).replace('[Datei "firmenlogo"]', '(BILD 2, das zweite mitgelieferte Bild)')}`;
}

/**
 * Gezielte Änderung: nimmt ein BESTEHENDES Creative als Input (nicht Neu-
 * Generierung aus dem Voll-Prompt) und ändert per gpt-image-2 /images/edits nur
 * den gewünschten Aspekt. Als Input bevorzugt das Basisbild OHNE Logo — das Logo
 * wird danach per Sharp-Overlay drauf gelegt, damit die KI es nicht verändert.
 *
 * Laedt Ergebnis in Storage hoch (Vorschau) und gibt die URLs zurueck; legt
 * KEINE DB-Row an (das macht der Apply-Schritt).
 *
 * @returns {Promise<{bildUrl:string, bildOhneLogoUrl:(string|null)}>}
 */
export async function generateGezielteAenderung({ job, kunde, creative, wunsch, logoAufKleidung = false, logoModus = 'voll' }) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY nicht gesetzt.');
  if (!wunsch?.trim()) throw new Error('Änderungswunsch fehlt.');

  const inputUrl = creative.bild_ohne_logo_url || creative.bild_url;
  if (!inputUrl) throw new Error('Creative hat kein Bild.');
  const nutztBasis = !!creative.bild_ohne_logo_url; // dann Logo nachtraeglich overlayen

  const { buffer: rawInput } = await fetchAsBuffer(inputUrl);
  const norm = await normalizeImageForOpenAI(rawInput, { label: 'Creative' });

  // Logo nur mitschicken, wenn gewuenscht UND vorhanden.
  const logoImMotiv = logoAufKleidung && !!kunde?.logo_url;
  let logoNorm = null;
  if (logoImMotiv) {
    const { buffer: logoRaw } = await fetchAsBuffer(kunde.logo_url);
    logoNorm = await normalizeImageForOpenAI(logoRaw, { label: 'Firmenlogo' });
  }

  const form = new FormData();
  form.append('model', 'gpt-image-2');
  form.append('prompt', buildEditPrompt(wunsch, logoImMotiv, logoModus));
  // 'auto' erhaelt das Seitenverhaeltnis der Eingabe (1:1 bzw. 9:16) —
  // die festen Groessen kennen kein 9:16.
  form.append('size', 'auto');
  form.append('quality', 'high');
  form.append('n', '1');
  form.append('image[]', bufferToFile(norm.buffer, `creative.${norm.ext}`, norm.contentType));
  // BILD 2 = Firmenlogo (nur bei logoAufKleidung) — als LETZTES Bild, wie im Prompt referenziert.
  if (logoNorm) form.append('image[]', bufferToFile(logoNorm.buffer, `firmenlogo.${logoNorm.ext}`, logoNorm.contentType));

  const response = await fetch(OPENAI_EDITS_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI ${response.status}: ${body.slice(0, 400)}`);
  }
  const data = await response.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI: keine Bild-Daten in Response.');

  // Auf kanonische Format-Groesse bringen (Seitenverhaeltnis stimmt dank 'auto'
  // schon; fit:'cover' gleicht nur Rundungsdifferenzen aus, ohne zu verzerren).
  let editedBase = Buffer.from(b64, 'base64');
  const [w, h] = FORMAT_PIXELS[creative.format] || [];
  if (w && h) {
    editedBase = await sharp(editedBase).resize({ width: w, height: h, fit: 'cover' }).png().toBuffer();
  }

  let finalBuffer = editedBase;
  let bildOhneLogoUrl = null;
  if (nutztBasis) {
    // Basis (ohne Logo) speichern + Logo an gespeicherter Position overlayen.
    const rawFilename = `${job.id}/raw-edit-${creative.format}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    try { bildOhneLogoUrl = await uploadToStorage(editedBase, rawFilename); }
    catch (err) { console.warn(`[gezielt] raw-upload skip: ${err.message}`); }
    try {
      const logoBuf = kunde?.logo_url ? (await fetchAsBuffer(kunde.logo_url)).buffer : null;
      const transparentLogo = await ensureTransparentLogo(kunde, logoBuf);
      finalBuffer = await composeLogoOverlay(editedBase, transparentLogo, creative.logo_position || {});
    } catch (err) { console.warn(`[gezielt] logo-overlay skip: ${err.message}`); }
  }

  const filename = `${job.id}/${creative.format}-edit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const bildUrl = await uploadToStorage(finalBuffer, filename);
  return { bildUrl, bildOhneLogoUrl };
}
