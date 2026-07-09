// Bild-Generierung für TalentOne Inside.
// - generateMotivVorschlaege: Claude schlägt 3 Bildmotive vor (basierend auf Job + Branche).
// - generateCreative:        OpenAI gpt-image-2 erzeugt ein Recruiting-Ad in einem Format,
//                            Upload nach Supabase Storage (Bucket: talentone-creatives).

import { callClaudeWithRetry, parseJsonContent } from './claude.js';
import { fetchAsBuffer, uploadBuffer } from './storage.js';
import { supabase } from './supabase.js';
import { makeTransparent, composeLogoOverlay } from './logo.js';

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
  const LOGO_FREI_HINWEIS = `KRITISCH — LOGO-REGEL: Zeichne im gesamten Bild KEIN Logo, KEIN Firmenlogo, KEIN Signet, KEIN Markenzeichen, KEINEN Firmenname-Text, KEINE Wortmarke, KEINE Buchstaben-Grafik, die an ein Logo erinnert. Das echte Original-Logo wird nachträglich per Code oben rechts als Overlay eingefügt. Halte im Bereich oben rechts (ca. 22% Breite × 18% Höhe, mit ~3% Abstand zum Rand) einen ruhigen, weitgehend flächigen Bereich frei (keine Gesichter, keine wichtigen Details, keine Text-Elemente) — der Bereich darf farblich Teil der Szene sein, aber ohne kritische Bildinhalte. Farb-Balance darf sich am mitgelieferten Logo orientieren, das Logo selbst darf NIRGENDS ins Bild.`;
  if (hasLogo && person) {
    refHinweis.push(
      `MITGELIEFERTE BILDER (in dieser Reihenfolge):`,
      `[BILD 1 — DATEINAME "firmenlogo"] = FIRMENLOGO. NUR als Farb-/Stil-Referenz. VERWENDE DIESES BILD NICHT als Person, NICHT als Hintergrund, NICHT als Bildelement. ${LOGO_FREI_HINWEIS}`,
      `[BILD 2 — DATEINAME "person"] = HAUPTMOTIV. Foto einer realen Person${person.beschreibung ? ` (Beschreibung: "${person.beschreibung}")` : ''}. DIESE Person ist die Hauptfigur des Creatives. Übernimm Gesichtszüge, Hauttyp, Haarfarbe, Frisur und Statur aus diesem Foto und stelle GENAU DIESE Person in der unten beschriebenen Szene dar — sie muss als dieselbe Person erkennbar bleiben. Kleidung darf der neuen Tätigkeit angepasst werden, das Gesicht NICHT.`,
    );
  } else if (hasLogo) {
    refHinweis.push(`MITGELIEFERTES BILD = FIRMENLOGO. NUR als Farb-/Stil-Referenz — NICHT ins Bild zeichnen. ${LOGO_FREI_HINWEIS}`);
  } else if (person) {
    refHinweis.push(`MITGELIEFERTES BILD = HAUPTMOTIV. Foto einer realen Person${person.beschreibung ? ` (Beschreibung: "${person.beschreibung}")` : ''}. Übernimm Gesichtszüge, Hauttyp, Haarfarbe, Frisur und Statur und stelle GENAU DIESE Person in der unten beschriebenen Szene dar — sie muss als dieselbe Person erkennbar bleiben.`);
  }

  const stelleGross = stelleClean(job.stelle).toUpperCase();
  const metaLeiste = buildMetaLeiste(job);
  const fbJobBlock = buildFixerJobBlock({ stelleGross, metaLeiste, farben: !!farben });

  return `Erstelle ein hochwertiges Social Media Recruiting Ad ${orientation} im Stil einer professionellen Recruiting-Agentur (Pinselstrich-/Spritzer-Elemente in Markenfarbe als gestalterisches Mittel).

${refHinweis.length ? refHinweis.join('\n') + '\n\n' : ''}${farben ? farben + '\n\n' : ''}BILDMOTIV (Hintergrund / Szene):
${motiv}
- Fotorealistisch, cinematic Look, warme Farben, leichter Bokeh-Effekt
- Branche: ${branche}
- Authentisch, Person(en) selbstbewusst und zufrieden — keine gestellten Stock-Fotos${person ? '\n- Die Person aus dem Referenzbild ist die Hauptfigur in dieser Szene.' : ''}

═══════════════════════════════════════════════════════════════
WICHTIG: DAS LAYOUT BESTEHT AUS 2 BEREICHEN — FESTER UNTERER BEREICH (Job-Block) + FLEXIBLER OBERER BEREICH
═══════════════════════════════════════════════════════════════

${fbJobBlock}

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

• Person/Hauptmotiv-Anordnung frei (links, rechts, mittig, ggf. freigestellt)
• Pinselstrich- oder Farbspritzer-Elemente in Markenfarbe als gestalterische Akzente (organisch, nicht überladen)

DESIGN-REGELN:
- HIERARCHIE der Größen: STELLENBEZEICHNUNG (am größten, formatfüllend im unteren Job-Block) > Hook (groß) > Benefits (kompakt) > Meta-Leiste & Logo (dezent)
- ${farben ? 'Markenfarben konsequent — Pinselstriche, Meta-Leiste, Stellen-Bereich.' : 'Wähle 1-2 kräftige Akzentfarben (z.B. orange/türkis/rot) und nutze sie für Pinselstriche, Meta-Leiste und Stellen-Bereich.'}
- Schrift modern, sehr lesbar. Stellenbezeichnung in fetten Großbuchstaben.
- Keine QR-Codes, keine Rahmen ums ganze Bild
- Stil: hochwertige Recruiting-Agentur-Anzeige (nicht Stock-Foto-Klischee)
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
[BILD 1 — DATEINAME "firmenlogo"] = FIRMENLOGO. NUR als Farb-/Stil-Referenz. Das Logo wird NIEMALS ins Bild gezeichnet — es wird nachträglich per Code als Overlay oben rechts eingefügt. Nutze das Bild nur, um die Markenfarbe zu erkennen.
[BILD 2 — DATEINAME "hintergrundfoto"] = HINTERGRUND. Übernimm dieses Foto EXAKT als Hintergrund, ohne es zu verändern: keine Personen austauschen, keine Komposition ändern, keine Farben verfälschen, keine Filter, kein neuer Bildstil. Es bleibt der echte, originale Foto-Look.`
    : `MITGELIEFERTES BILD = HINTERGRUND. Übernimm dieses Foto EXAKT als Hintergrund, ohne es zu verändern: keine Personen austauschen, keine Komposition ändern, keine Farben verfälschen, keine Filter, kein neuer Bildstil. Es bleibt der echte, originale Foto-Look.`;

  const stelleGross = stelleClean(job.stelle).toUpperCase();
  const metaLeiste = buildMetaLeiste(job);
  const fbJobBlock = buildFixerJobBlock({ stelleGross, metaLeiste, farben: !!farben });

  return `Erstelle ein professionelles Recruiting-Ad-Overlay ${orientation} im Stil einer hochwertigen Recruiting-Agentur (Pinselstrich-/Spritzer-Elemente in Markenfarbe als gestalterisches Mittel).

${refLines}

${farben ? farben + '\n\n' : ''}Falls das Hintergrundfoto nicht im Zielformat ist, beschneide es respektvoll (Person/wesentliche Bildelemente sichtbar lassen).

═══════════════════════════════════════════════════════════════
WICHTIG: DAS OVERLAY HAT 2 BEREICHE — FESTER UNTERER BEREICH (Job-Block) + FLEXIBLER OBERER BEREICH
═══════════════════════════════════════════════════════════════

${fbJobBlock}

═══════════════════════════════════════════════════════════════
FLEXIBLER BEREICH OBEN (ca. obere 65% — du wählst Stil & Anordnung der Overlay-Elemente):
═══════════════════════════════════════════════════════════════

• HOOK / HAUPTSPRUCH (Position frei — z.B. im oberen Drittel oder mittig):
  ${spruch?.trim()
    ? `Verwende EXAKT diesen Wortlaut: "${spruch.trim()}". KEINEN eigenen Spruch erfinden — nutze GENAU diese Wörter. GROSS, fett, sofort fesselnd; gerne auf einem PINSELSTRICH-Banner in Markenfarbe gesetzt (ungleichmäßige Kanten).`
    : 'Kurzer Recruiting-Spruch (max. 5-6 Wörter, 2-3 Wörter pro Zeile). Setze ihn gerne auf einen PINSELSTRICH-Banner in Markenfarbe. KEIN "Wir suchen dich"-Klischee.'}

• BENEFIT-BADGES (Position frei): 3-4 RUNDE Icon-Badges (Kreise, ca. 60-90px Durchmesser) mit Icon + kurzer Beschriftung: ${benefitListe}
  Kompakte Begriffe wie "Firmenwagen", "Tankkarte", "30 Tage Urlaub". Anordnung frei.

• ${hasLogo
    ? `LOGO wird NACHTRÄGLICH oben rechts als Overlay eingefügt — der Bereich oben rechts (ca. 22% Breite × 15% Höhe, mit Abstand zum Rand) bleibt VÖLLIG FREI. Zeichne dort NICHTS: kein Logo, kein Signet, kein Firmenname-Text, keine Marken-Grafik. Falls das Hintergrundfoto in diesem Bereich Bildinhalt hat, den Bereich mit einem dezenten dunklen Verlauf abdunkeln — sonst nichts.`
    : `FIRMENNAME-SCHRIFTZUG dezent oben: "${firmenname}" als sauberer Text-Schriftzug, klein. KEIN Logo-Element.`}

• Pinselstrich- oder Farbspritzer-Akzente in Markenfarbe (organisch, nicht überladen)

DESIGN-REGELN:
- HIERARCHIE der Größen: STELLENBEZEICHNUNG (formatfüllend im unteren Job-Block) > Hook (groß) > Benefits (kompakt) > Meta-Leiste & Logo (dezent)
- Dunkler halbtransparenter Gradient/Schatten hinter Overlay-Texten falls nötig für Lesbarkeit — das Foto bleibt der Held
- ${farben ? 'Markenfarben konsequent — Pinselstriche, Meta-Leiste, Stellen-Bereich.' : 'Wähle 1-2 kräftige Akzentfarben (orange/türkis/rot) für Pinselstriche und Stellen-Bereich.'}
- Schrift modern, sehr lesbar. Stellenbezeichnung in fetten Großbuchstaben.
- Keine zusätzlichen Filter aufs Foto, keine Verfremdung
- Keine QR-Codes, keine Rahmen ums ganze Bild
- Wirkung: echtes Foto = Held, Overlay-Job-Block macht klar "hier wird XY gesucht in der Region"`;
}

// Wrapper — wählt den passenden Prompt anhand des Projekttyps und Modus.
// Projekttyp „neukundengewinnung" → Lead-Gen-Layout (Produkt/Ergebnis im Fokus,
// CTA „Kostenloses Angebot", keine Stellenbezeichnung). Sonst Recruiting.
export function buildCreativePrompt({ job, kunde, motiv, format, mode = 'ki', hasLogo, person, spruch }) {
  if (job?.projekttyp === 'neukundengewinnung') {
    return buildPromptNeukunden({ job, kunde, motiv, format, mode, hasLogo, person, spruch });
  }
  if (mode === 'foto') return buildPromptFoto({ job, kunde, format, hasLogo, spruch });
  return buildPromptKI({ job, kunde, motiv, format, hasLogo, person, spruch });
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

  const rawBuffer = Buffer.from(b64, 'base64');
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
export async function generateVariant({ job, kunde, motiv, mode = 'ki', referenceImages = [], spruch }) {
  const formats = ['quadrat', 'story'];
  const results = await Promise.allSettled(
    formats.map(format => generateOneCreative({ job, kunde, motiv, format, mode, referenceImages, spruch })),
  );
  const ok = results.filter(r => r.status === 'fulfilled').map(r => r.value);
  const errors = results.filter(r => r.status === 'rejected').map(r => r.reason.message);
  return { ok, errors };
}
