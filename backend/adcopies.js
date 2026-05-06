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

function buildBriefing(job, kunde) {
  const fd = job.formdata_komplett || {};
  const benefits = Array.isArray(job.benefits) ? job.benefits : [];
  const branche = BRANCHE_LABEL[kunde?.branche] || kunde?.branche || '';
  return `BRIEFING:
- Firma: ${kunde?.firmenname || '-'}
- Branche: ${branche || '-'}
- Stelle: ${job.stelle || '-'}
- Region: ${job.region || '-'}
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
  emotional: `STIL: EMOTIONAL / STORY
- Länge: 150-200 Wörter
- Erzählerisch, spricht Gefühle an, persönlich, macht neugierig
- Gerne mit "Stell dir vor…", einer Mini-Szene, einem inneren Bild starten
- KEIN Recruiting-Floskelsprech ("dynamisches Team", "spannende Aufgaben", "wir suchen Sie")
- Hauptfigur: die Bewerber:in, nicht das Unternehmen
- Endet mit klarem CTA (z.B. "Schreib uns eine Nachricht — wir freuen uns auf dich.")`,
  benefit: `STIL: BENEFIT-FOKUSSIERT
- Länge: 120-150 Wörter
- Direkt, klar strukturiert, faktenbasiert
- Listet die stärksten konkreten Vorteile auf — gerne als kurze Aufzählung mit Bullet-Strichen "•"
- Tonalität: "Das bekommst du bei uns:"
- Keine Floskeln, jeder Satz muss ein konkretes Versprechen liefern
- Endet mit klarem, niedrigschwelligem CTA`,
  kompakt: `STIL: DIREKT / KNAPP
- Länge: 50-80 Wörter, MAX 4 Sätze
- Social-Media-Hook, scrolltauglich
- Provokant oder überraschend (eine ungewöhnliche Frage, Zahl, Beobachtung)
- Sehr kurz, kein Fluff, kein "wir bieten…"
- Eine starke Aussage + 1-2 Stichpunkte + CTA`,
};

function buildPrompt(job, kunde, style) {
  return `${buildBriefing(job, kunde)}

AUFGABE: Schreibe genau EINEN deutschen Recruiting-Werbetext für die obige Stelle.

${STYLE_SPEC[style]}

Wichtig:
- Sprich die Bewerber:innen mit "du" an (informell)
- Konkret, spezifisch, kein Stock-Sprech
- Wenn relevant Benefits / Besonderheiten / "warum gern hier" einarbeiten — aber natürlich verwoben, nicht abgehakt
- KEIN Hashtag, KEIN Emoji
- Antworte NUR mit JSON, keine Markdown-Backticks:

{ "text": "<dein fertiger Werbetext>" }`;
}

// Generiert einen Werbetext zu einem Style. Wirft bei Claude-Fehler.
export async function generateAdCopy({ job, kunde, style }) {
  if (!isValidStyle(style)) throw new Error(`Unbekannter Stil: ${style}`);
  const data = await callClaudeWithRetry({
    model: CLAUDE_MODEL,
    max_tokens: 1200,
    messages: [{ role: 'user', content: buildPrompt(job, kunde, style) }],
  });
  const parsed = parseJsonContent(data);
  const text = (parsed.text || '').trim();
  if (!text) throw new Error('Claude lieferte leeren Text.');
  return { stil: style, text };
}
