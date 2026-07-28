// Liest eine Stellenanzeige (URL oder PDF/DOCX) und extrahiert strukturierte Daten via Claude.
// Gibt ein einheitliches Objekt zurück, das wir in Kunde + Job mappen.

import { callClaudeWithRetry, parseJsonContent } from './claude.js';

const CLAUDE_MODEL = 'claude-sonnet-4-6';

const EXTRACT_PROMPT = (text) => `Du liest eine Stellenanzeige und extrahierst die wichtigsten Informationen.

Stellenanzeige:
---
${text}
---

Extrahiere die Informationen und antworte NUR mit einem JSON-Objekt, ohne Markdown-Backticks:

{
  "firma": "Name des Unternehmens/Arbeitgebers oder leer",
  "ansprechpartner": "Name des Ansprechpartners oder leer",
  "kontakt_email": "E-Mail aus der Anzeige oder leer",
  "kontakt_telefon": "Telefonnummer aus der Anzeige oder leer",
  "branche": "handwerk|pflege|einzelhandel|gastro|buero|logistik oder leer",
  "position": "Stellenbezeichnung oder leer",
  "standort": "Stadt / Region oder leer",
  "gehalt": "Gehalt/Vergütung wenn genannt oder leer",
  "anstellungsart": "vollzeit|teilzeit|beide|ausbildung oder leer",
  "ausbildung": "Geforderte Ausbildung/Qualifikation oder leer",
  "kenntnisse": "Wichtigste 2-3 fachliche Kenntnisse als kurze Aufzählung oder leer",
  "aufgaben": "Wichtigste typische Aufgaben als kurze Aufzählung oder leer",
  "benefits": ["Liste der erwähnten Benefits als Array"],
  "unterschied": "Was den Betrieb von anderen ARBEITGEBERN unterscheidet (Alleinstellung als Arbeitgeber) — aus Formulierungen wie 'Bei uns...', 'Was uns ausmacht', 'Wir über uns'. Nur wenn im Text. Sonst leer.",
  "mitarbeiter_gerne": "Warum Mitarbeiter GERNE hier arbeiten: Team-Events, Zusammenhalt, Kultur-Extras die KEINE harten Benefits sind. Nur wenn im Text. Sonst leer.",
  "unternehmenskultur": "Beschreibung der Unternehmenskultur / des Betriebsklimas (z. B. 'familiär', 'modern', 'kollegial', Teamgeist). Nur wenn im Text. Sonst leer.",
  "mitarbeiterzahl": "Mitarbeiterzahl NUR wenn im Text genannt (z. B. '30 Mitarbeiter', 'über 100 Kollegen', 'ein Team von 15'). Auf GENAU einen dieser Werte mappen: 1-10 | 11-50 | 51-200 | 200+. Sonst leer.",
  "reisebereitschaft": false,
  "quereinsteiger": false
}

WICHTIG: Extrahiere NUR, was tatsächlich im Text steht — nichts erfinden oder raten. Fehlt eine Angabe, lass das Feld leer ("" bzw. leeres Array). Gerade die "Über uns"-Felder (unterschied, mitarbeiter_gerne, unternehmenskultur, mitarbeiterzahl) nur befüllen, wenn der Text dazu wirklich etwas hergibt.`;

// Prompt für Neukunden-Extraktion (Landingpages, Angebots-PDFs, Firmen-Websites).
// Andere Semantik: Produkt/Dienstleistung + Zielgruppe + USP statt Stellendaten.
const EXTRACT_PROMPT_NEUKUNDEN = (text) => `Du liest den Inhalt einer Firmen-Website / Landingpage / Produktbroschüre und extrahierst die wichtigsten Informationen für eine Neukundengewinnungs-Kampagne (nicht Recruiting!).

Inhalt:
---
${text}
---

Extrahiere und antworte NUR mit einem JSON-Objekt, ohne Markdown-Backticks:

{
  "firma": "Name des Unternehmens oder leer",
  "branche": "handwerk|pflege|einzelhandel|gastro|buero|logistik oder leer",
  "produkt": "Das Hauptprodukt oder die Dienstleistung — was wird angeboten? Kurz und prägnant, max. 60 Zeichen.",
  "kundenprofil": "Für welche Kunden ist das Angebot gedacht? Für welchen Zweck / welche Nische?",
  "zielgruppe": "Wer soll erreicht werden (Alter, Situation, Region, Bedürfnis) — kurz.",
  "vorteile": ["Array der wichtigsten Produkt-Vorteile / Alleinstellungsmerkmale, jeweils prägnant (max. 5 Einträge)"],
  "unterschied": "Was unterscheidet den Anbieter vom Wettbewerb (USP)?",
  "preisrahmen": "Preisangabe / Angebot wenn genannt, z. B. 'ab 15.000 €' oder leer",
  "einzugsgebiet": "Region / Einzugsgebiet aus dem Text oder leer",
  "kontakt_email": "E-Mail-Adresse aus dem Text oder leer",
  "kontakt_telefon": "Telefonnummer aus dem Text oder leer"
}`;

async function callClaude(text, promptFactory = EXTRACT_PROMPT) {
  const truncated = text.slice(0, 5000);
  const data = await callClaudeWithRetry({
    model: CLAUDE_MODEL,
    max_tokens: 1000,
    messages: [{ role: 'user', content: promptFactory(truncated) }],
  });
  return parseJsonContent(data);
}

export async function extractFromUrl(url, opts = {}) {
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error('Ungültige URL.');
  }

  const puppeteer = (await import('puppeteer')).default;
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  let textContent;
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (compatible; TalentOneInsideBot/1.0)');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
    textContent = await page.evaluate(() => {
      document.querySelectorAll('script, style, noscript').forEach(el => el.remove());
      return document.body?.innerText || '';
    });
  } finally {
    await browser.close();
  }

  if (!textContent || textContent.trim().length < 50) {
    throw new Error('Konnte keinen Text von der URL lesen.');
  }

  return await extractFromText(textContent, opts);
}

export async function extractFromFile(fileData, fileType, opts = {}) {
  if (!fileData) throw new Error('Keine Datei.');

  const buffer = Buffer.from(fileData, 'base64');
  let text = '';

  if (fileType === 'pdf' || fileType === 'application/pdf') {
    const pdfParse = (await import('pdf-parse')).default;
    const result = await pdfParse(buffer);
    text = result.text || '';
  } else if (fileType === 'docx' || fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    text = result.value || '';
  } else {
    throw new Error(`Format nicht unterstützt: ${fileType}`);
  }

  if (!text || text.trim().length < 50) {
    throw new Error('Konnte keinen Text aus der Datei lesen.');
  }

  return await extractFromText(text, opts);
}

/** Extrahiert aus bereits geparstem Text (gemeinsamer Kern von URL/File). */
export async function extractFromText(text, opts = {}) {
  const prompt = opts.projekttyp === 'neukundengewinnung' ? EXTRACT_PROMPT_NEUKUNDEN : EXTRACT_PROMPT;
  return await callClaude(text, prompt);
}

// Mappt das extrahierte Objekt auf eine talentone_kunden-Zeile
export function toKunde(extracted) {
  return {
    firmenname: extracted.firma || null,
    ansprechpartner: extracted.ansprechpartner || null,
    email: extracted.kontakt_email || null,
    telefon: extracted.kontakt_telefon || null,
    branche: extracted.branche || null,
  };
}

// Mappt das extrahierte Objekt auf eine talentone_jobs-Zeile (ohne kunde_id)
export function toJob(extracted, eingabeMethode, sourceUrl = null) {
  const benefits = Array.isArray(extracted.benefits) ? extracted.benefits : [];
  const besonderheitenParts = [
    extracted.unterschied && `Unterschied: ${extracted.unterschied}`,
    extracted.unternehmenskultur && `Kultur: ${extracted.unternehmenskultur}`,
    extracted.mitarbeiter_gerne && `Gerne hier: ${extracted.mitarbeiter_gerne}`,
    extracted.aufgaben && `Aufgaben: ${extracted.aufgaben}`,
    extracted.kenntnisse && `Kenntnisse: ${extracted.kenntnisse}`,
  ].filter(Boolean);
  return {
    stelle: extracted.position || null,
    region: extracted.standort || null,
    gehalt: extracted.gehalt || null,
    benefits: benefits.length ? benefits : null,
    besonderheiten: besonderheitenParts.join(' | ') || null,
    reisebereitschaft: !!extracted.reisebereitschaft,
    quereinsteiger: !!extracted.quereinsteiger,
    eingabe_methode: eingabeMethode,
    url: sourceUrl,
    formdata_komplett: extracted,
  };
}
