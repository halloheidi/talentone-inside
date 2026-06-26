// Generator für Recruiting-Ad-Copies via Claude Sonnet 4.6.
// Drei Styles: emotional / benefit / kompakt.

import { callClaudeWithRetry, parseJsonContent } from './claude.js';

const CLAUDE_MODEL = 'claude-sonnet-4-6';

const BRANCHE_LABEL = {
  handwerk: 'Handwerk & Bau', pflege: 'Pflege & Soziales', einzelhandel: 'Einzelhandel',
  gastro: 'Gastronomie & Hotel', buero: 'Büro & Verwaltung', logistik: 'Logistik & Transport',
};

const STYLE_LABEL = {
  emotional: 'Emotional',
  benefit:   'Benefits',
  kompakt:   'Knackig',
};

export const STYLES = ['emotional', 'benefit', 'kompakt'];
export function isValidStyle(s) { return STYLES.includes(s); }
export function styleLabel(s)   { return STYLE_LABEL[s] || s; }

function joinList(...vals) {
  return vals.flat().filter(v => v && String(v).trim()).join(', ');
}

// Stellenbezeichnung mit (m/w/d) — hängt es an wenn noch nicht vorhanden
function stelleDisplay(stelle) {
  if (!stelle) return 'Mitarbeiter:in (m/w/d)';
  if (/\([mwfd][\/\\mwfd\s\-]+\)/i.test(stelle)) return stelle.trim();
  return `${stelle.trim()} (m/w/d)`;
}

// Nur der Ort — entfernt typische Umkreis-Suffixe (+30km, (30km Umkreis), Umkreis 30km …)
function cleanOrt(region) {
  if (!region) return '';
  return String(region)
    .replace(/\s*[\(\[\+,]\s*\d+\s*km\s*(umkreis)?\s*[\)\]]?/gi, '')
    .replace(/\s*umkreis\s+\d+\s*km/gi, '')
    .replace(/\s*\(\s*umkreis\s*\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildBriefing(job, kunde) {
  const fd = job.formdata_komplett || {};
  const benefits = Array.isArray(job.benefits) ? job.benefits : [];
  const branche = BRANCHE_LABEL[kunde?.branche] || kunde?.branche || '';
  return `BRIEFING:
- Firma: ${kunde?.firmenname || '-'}
- Branche: ${branche || '-'}
- Stelle: ${stelleDisplay(job.stelle)}
- Ort (NUR Ort, ohne Umkreis): ${cleanOrt(job.region) || '-'}
- Gehalt: ${job.gehalt || '-'}
- Benefits: ${joinList(benefits, fd.benefits_zusatz) || '-'}
- Besonderheiten der Stelle: ${job.besonderheiten || '-'}
- Was den Arbeitgeber unterscheidet: ${fd.unterschied || '-'}
- Warum Mitarbeiter gerne hier arbeiten: ${fd.mitarbeiter_gerne || '-'}
- Unternehmenskultur: ${fd.unternehmenskultur || '-'}
- Mitarbeiterzahl: ${fd.mitarbeiter_anzahl || '-'}
- Quereinsteiger willkommen: ${job.quereinsteiger ? 'ja' : 'nein'}
- Reisebereitschaft: ${job.reisebereitschaft ? 'ja' : 'nein'}
- Geforderte Ausbildung: ${fd.ausbildung || '-'}
- Soft Skills: ${joinList(fd.soft_skills, fd.soft_skills_zusatz) || '-'}
- Ideale Eigenschaften: ${fd.kandidat_eigenschaften || '-'}`;
}

const STYLE_SPEC = {
  emotional: `STIL: EMOTIONAL / STORY — 130-180 Wörter

ZWINGENDER AUFBAU (jede Sektion mit Leerzeile getrennt):
Zeile 1: 🔥 (oder anderes branchenpassendes Emoji) + ein STARKER Hook-Satz, der zum Stoppen zwingt
[Leerzeile]
2-3 Sätze emotionale Mini-Story — Du-Ansprache, "Stell dir vor…" / "Kennst du das…" / provokante Frage / persönliches Bild
[Leerzeile]
3-5 Benefit-Zeilen, jede beginnt mit ✅ und nennt konkret einen Vorteil (kurz, nicht ganze Sätze)
✅ ...und vieles mehr!
[Leerzeile]
👉 Klare Aufforderung (z.B. "Jetzt bewerben — dauert keine Minute" oder "Schreib uns eine Nachricht")
📍 ${'${region}'} (Standort)`,

  benefit: `STIL: BENEFIT-FOKUSSIERT — 120-160 Wörter

ZWINGENDER AUFBAU:
Zeile 1: 🚀 (oder branchenpassendes Emoji) + "[Stellenbezeichnung] gesucht bei [Firma]!" oder eine andere prägnante Headline
[Leerzeile]
"Das erwartet dich:"
[Leerzeile]
5-7 Benefit-Zeilen, jede mit individuell passendem Emoji am Anfang + konkreter Benefit (kein Standardsatz):
💰 [Vorteil zu Geld]
🚗 [Vorteil zu Mobilität / Auto]
🏖️ [Vorteil zu Urlaub]
📚 [Vorteil zu Weiterbildung]
⏰ [Vorteil zu Arbeitszeit]
[oder andere passende Emojis: 🛠️ 🤝 🏆 🌱 💪 🎯 etc.]
➕ u.v.m.
[Leerzeile]
2 Kontrast-Zeilen (nur wenn Briefing Anlass gibt — sonst weglassen):
❌ Kein [branchentypisches Problem]
❌ Kein [weiteres Problem]
[Leerzeile]
✅ Stattdessen: [klares positives Gegenteil]
[Leerzeile]
📩 Niedrigschwelliger CTA ("Bewirb dich jetzt in unter 1 Minute!")
📍 ${'${region}'}`,

  kompakt: `STIL: KNACKIG / PROVOKANT — 50-90 Wörter

ZWINGENDER AUFBAU:
Zeile 1: Provokante Frage oder ungewöhnliches Statement + Emoji am Ende (🤔 / 😳 / 💡 / 🤯 — passend wählen)
[Leerzeile]
"3 Gründe warum [Stelle] bei [Firma] anders ist:"
[Leerzeile]
1️⃣ [Benefit, MAX 6 Wörter]
2️⃣ [Benefit, MAX 6 Wörter]
3️⃣ [Benefit, MAX 6 Wörter]
[Leerzeile]
👉 [3-Wort-CTA — z.B. "Link klicken. Bewerben. Fertig."]`,
};

export const LINK_PLACEHOLDER = '[Funnel-Link wird ergänzt]';

function buildPrompt(job, kunde, style, funnelUrl) {
  const ort = cleanOrt(job.region) || 'Region';
  const stelle = stelleDisplay(job.stelle);
  const firma = kunde?.firmenname || 'das Unternehmen';

  // Template-Platzhalter im STYLE_SPEC durch reale Werte ersetzen
  const spec = STYLE_SPEC[style]
    .replaceAll('${region}', ort)   // alte Variable mappt auf cleaned ort
    .replaceAll('${ort}', ort)
    .replaceAll('${stelle}', stelle)
    .replaceAll('${firma}', firma);

  const linkBlock = funnelUrl
    ? `BEWERBUNGS-LINK: ${funnelUrl}
Diesen Link MUSS in der CTA-Zeile am Ende exakt so vorkommen (z.B. "👉 Jetzt bewerben: ${funnelUrl}").`
    : `BEWERBUNGS-LINK: noch kein Funnel-Link verfügbar.
In der CTA-Zeile am Ende verwende DIESEN Platzhalter EXAKT (wird später automatisch ersetzt):
${LINK_PLACEHOLDER}
Beispiel: "👉 Jetzt bewerben: ${LINK_PLACEHOLDER}"`;

  return `${buildBriefing(job, kunde)}

${linkBlock}

AUFGABE
Schreibe EINE deutsche Social-Media-Recruiting-Ad für Facebook und Instagram. Diese Ad muss beim Scrollen sofort catchen — sie ist standalone (auch ohne Bild verständlich) und visuell strukturiert mit Emojis und Zeilenumbrüchen. KEIN Fließtext!

${spec}

GLOBALE REGELN
- Du-Ansprache, locker, auf Augenhöhe — KEIN "Wir suchen dich"-Klischee, KEIN "Bewerben Sie sich" / "Sehr geehrte Damen und Herren", KEIN HR-Sprech ("spannende Aufgaben", "dynamisches Team")
- Emojis MÜSSEN passen — zur Branche (${kunde?.branche || 'allgemein'}) und zum jeweiligen Benefit. Nicht random.
- Benefits konkret benennen mit Zahlen wenn möglich (z.B. "30 Tage Urlaub" statt "viel Urlaub", "Bis 4.500 €" statt "gutes Gehalt")
- Echte Zeilenumbrüche zwischen den Sektionen (im JSON als \\n) — KEINE Bullet-Strings in einer Zeile
- Referenz-Vorbilder im Stil: Performance Recruiting, Terbeek, Schilling — kurze visuelle Häppchen, jede Zeile ein Wert
- Stellenbezeichnung IMMER mit "(m/w/d)" am Ende — z.B. "Fahrzeugaufbereiter (m/w/d)", "Pflegefachkraft (m/w/d)". Niemals ohne.
- Standort: NUR den Ort nennen (z.B. "📍 Essen"), KEINEN Umkreis / Radius / "+30km" / "(Umkreis 50km)".

FORMAT
Antworte NUR mit JSON, keine Markdown-Backticks:
{ "text": "<dein fertiger Ad-Text mit echten Zeilenumbrüchen als \\n>" }`;
}

/* ───────────────────── Headlines / Überschriften ─────────────────────
   5 starke Recruiting-Headlines pro Kampagne, jede mit passendem Emoji
   davor. Werden im Meta-Ads-Composer als Headline-Set verwendet
   (Multi-Variant-Test) bzw. in unseren eigenen Funnel-/Anzeigen-Texten.  */

export async function generateHeadlines({ job, kunde }) {
  const stelle = job?.stelle || 'Mitarbeiter:in';
  const branche = BRANCHE_LABEL[kunde?.branche] || kunde?.branche || '';
  const region = cleanOrt(job?.region) || '';
  const benefits = Array.isArray(job?.benefits) ? job.benefits.filter(Boolean).slice(0, 5) : [];

  const prompt = `Du bist Copywriter für High-Performance Recruiting-Ads (Meta/Instagram). Schlage 5 unterschiedliche deutsche HEADLINES (Überschriften) für die Stelle "${stelle}"${branche ? ` (${branche})` : ''}${region ? `, ${region}` : ''}${benefits.length ? `, Benefits: ${benefits.join(', ')}` : ''} vor.

ANFORDERUNGEN an JEDE Headline:
- Max. 40 Zeichen (Meta-Anzeige-Limit) — wirklich kurz halten
- Beginnt mit einem PASSENDEN Emoji (ein einzelnes, kein Set), das zur Stelle/Branche/Aussage passt
- Sprich Kandidaten direkt an (Du-Form okay) oder mache eine starke Aussage
- KEIN "Wir suchen dich"-Klischee, KEIN reines Stellentitel-Wiederholen
- Verschiedene Hooks/Tonalitäten — Curiosity, Benefit, Frage, Pain Point, Anerkennung

Beispiele (zur Inspiration, nicht 1:1 kopieren):
- "🔧 Endlich Werkzeug das was kann"
- "💰 Mehr als 3.500€ — verdient."
- "🚀 Karriere ohne BWL-Floskeln"
- "❤️ Pflege, die nicht ausbrennt"
- "📍 5 Min von dir — Wechsel?"

Liefere genau 5 Headlines, JEDE mit einem unterschiedlichen Emoji am Anfang. Verschiedene Emojis je nach Tonalität: ein Werkzeug-Emoji wenn handwerklich, ❤️ für Pflege, 💰 für Gehalt, ⏰ für Zeit, 🚀 für Karriere, 📍 für Standort, 🔥 für „hot job", ✋ für Stop-Scroll, 🎯 für treffsicher, usw.

Antworte NUR mit JSON, keine Markdown-Backticks:

{ "headlines": ["Headline 1 mit Emoji", "Headline 2 mit Emoji", "Headline 3 mit Emoji", "Headline 4 mit Emoji", "Headline 5 mit Emoji"] }`;

  const data = await callClaudeWithRetry({
    model: CLAUDE_MODEL,
    max_tokens: 700,
    messages: [{ role: 'user', content: prompt }],
  });
  const parsed = parseJsonContent(data);
  return Array.isArray(parsed.headlines) ? parsed.headlines.slice(0, 5) : [];
}

// Generiert einen Werbetext zu einem Style. Wirft bei Claude-Fehler.
export async function generateAdCopy({ job, kunde, style, funnelUrl }) {
  if (!isValidStyle(style)) throw new Error(`Unbekannter Stil: ${style}`);
  const data = await callClaudeWithRetry({
    model: CLAUDE_MODEL,
    max_tokens: 1500, // mehr Puffer wegen Emojis (mehrere Tokens pro Symbol)
    messages: [{ role: 'user', content: buildPrompt(job, kunde, style, funnelUrl) }],
  });
  const parsed = parseJsonContent(data);
  let text = (parsed.text || '').trim();
  if (!text) throw new Error('Claude lieferte leeren Text.');
  // Sicherheitsnetz: falls Claude den Platzhalter / Link doch nicht eingebaut hat
  text = ensureLinkInText(text, funnelUrl);
  return { stil: style, text };
}

// Stellt sicher, dass der Funnel-Link (oder Platzhalter) im Text steht. Idempotent.
export function ensureLinkInText(text, funnelUrl) {
  if (!text) return text;
  const target = funnelUrl || LINK_PLACEHOLDER;
  // Bereits drin?
  if (text.includes(target)) return text;
  // Platzhalter vorhanden aber falsch → ersetzen
  if (text.includes(LINK_PLACEHOLDER) && funnelUrl) {
    return text.replace(LINK_PLACEHOLDER, funnelUrl);
  }
  // Alte URL im Text? → ersetzen (greift wenn vorher anderer Funnel-Link)
  const urlMatch = text.match(/https?:\/\/\S+/);
  if (urlMatch && funnelUrl) {
    return text.replace(urlMatch[0], funnelUrl);
  }
  // Sonst: am Ende anhängen
  return text.trimEnd() + `\n\n👉 Jetzt bewerben: ${target}`;
}
