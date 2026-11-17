// Reel-Modul Schritt 1: Skript (9 Sätze + fester Schluss) + Motive je Satz via Claude.
// Siehe docs/reel-modul-spec.md §2. Ausgabe strikt als JSON, normalisiert in skript[]+motive[].

import { callClaudeWithRetry, parseJsonContent } from './claude.js';
import { STIL_BLOCK, SCHLUSS_DU, SCHLUSS_SIE, SATZ_ANZAHL } from './reel-config.js';

const CLAUDE_MODEL = 'claude-sonnet-4-6';

const istDu = (anrede) => anrede !== 'sie';

// Wörter grob auf 2 Zeilen aufteilen (Fallback, falls das Modell keine zeilen liefert).
function teileZeilen(text) {
  const w = String(text || '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  if (w.length <= 3) return [w.join(' ').toUpperCase()];
  const mid = Math.ceil(w.length / 2);
  return [w.slice(0, mid).join(' ').toUpperCase(), w.slice(mid).join(' ').toUpperCase()];
}

// Entfernt Rauschen aus einem DB-Objekt, bevor es als Kontext an Claude geht.
const NOISE = /(^id$|_id$|_token$|^created_at$|^updated_at$|^embedding|_am$|^raw|snapshot|^portal_token$)/i;
function kompakt(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (NOISE.test(k)) continue;
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    out[k] = v;
  }
  return out;
}

function masterVorlage({ stil, hatPersonfoto }) {
  return `MASTER-PROMPT-VORLAGE (fülle die [Klammern] aus den Firmendaten, behalte die Struktur und die Zeilen genau so bei):
Ich erstelle eine Bildserie für ein Recruiting-Video eines [Gewerk]-Betriebs in [Ort]. Halte dich bei allen Bildern an diese Regeln:
Person: Der/die [Berufsbezeichnung] ist immer die Person aus dem Referenzfoto. Gleiches Gesicht, gleiche Statur, gleiche Frisur. Keine Variation von Bild zu Bild.${hatPersonfoto ? '' : ' Ich erzeuge die Person im ersten Schritt, danach gilt dieses Bild als Referenz.'}
Kleidung: [Arbeitskleidung laut Branche], auf der linken Brust klein das Logo.
Logo: Das Logo aus der PNG-Datei exakt übernehmen: [kurze Logo-Beschreibung]. Nicht neu zeichnen, keine Buchstaben hinzufügen oder ändern.
Fahrzeug: [Firmenfahrzeug, falls relevant], Kennzeichen unscharf, keine lesbare Telefonnummer.
Gebäude: [falls relevant: exakt das Gebäude aus dem Referenzfoto, nur Perspektive und Licht dürfen abweichen].
Stil: ${STIL_BLOCK[stil] || STIL_BLOCK.foto}
Format: Hochformat 2:3. Hauptmotiv mittig, seitlich Luft.
Nicht im Bild: Kein Text außer Logo und Fahrzeugbeschriftung, keine Schilder, keine Wasserzeichen, keine Grafikelemente.
Bewegung: Personen mitten in einer Tätigkeit, nicht posierend in die Kamera.`;
}

export function buildSystemPrompt({ anrede, stil, mehrereStellen, hatStimme, gehaltAnzeigen, hatPersonfoto }) {
  const du = istDu(anrede);
  const schluss = du ? SCHLUSS_DU : SCHLUSS_SIE;
  return `Du schreibst das Sprecherskript für ein vertikales Recruiting-Reel (B-Roll-Stil) eines Handwerks-/Mittelstandsbetriebs. Ansprache: ${du ? 'Du (locker, direkt, auf Augenhöhe)' : 'Sie (höflich, seriös)'}.

REGELN:
- Genau ${SATZ_ANZAHL} Sätze. Den festen Schlusssatz ("${schluss}") fügt das System selbst an — gib ihn NICHT aus.
- Jeder Satz 6 bis 14 Wörter, gesprochen 3 bis 7 Sekunden. Gesamt 40 bis 48 Sekunden.
- Satz 1 = konkreter Hook aus dem Alltag (Uhrzeit, Ort, Firmenwagen o. ä.).
- Satz 2 = "Wir sind [Firma], [Gewerk] in [Ort]" plus das stärkste Firmenmerkmal (Gründungsjahr, Generation, Auszeichnung).
- Sätze 3–8 = Aufgaben und Benefits in Alltagssprache, konkret.
- Satz 9 = Zielgruppe direkt ansprechen ("Wir suchen …, die …").
${mehrereStellen ? `- Mehrere Stellen: EIN Satz der Form "Ob ${du ? 'du' : 'Sie'} lieber A … oder B …: Bei uns geht beides."\n` : ''}${hatStimme ? '- Es liegt eine freigegebene Mitarbeiterstimme vor: baue sie bevorzugt in Satz 7 als echtes, gekürztes Zitat ein (8–12 gesprochene Wörter, ohne Namen), als gesprochener Satz.\n' : ''}- Keine Floskeln ("dynamisches Team", "familiäres Umfeld"). ${gehaltAnzeigen ? 'Gehalt darf genannt werden, wenn in den Daten vorhanden.' : 'KEINE Gehaltszahlen.'} Keine Versprechen, die nicht in den Benefits/Besonderheiten stehen.

Pro Satz lieferst du zusätzlich:
- "zeilen": 2–3 kurze Typografie-Zeilen in GROSSBUCHSTABEN, die den Satz sinnvoll aufteilen.
- "schluesselwoerter": 0–2 Wörter aus dem Satz, die hervorgehoben werden (ohne Satzzeichen, exakt wie im Text geschrieben).
- "motiv": EIN Bildmotiv zum Satz:
   - "titel": kurzer Titel.
   - "prompt": 2–3 Sätze (Ort, Tätigkeit, Kameraposition, Licht) — eine fotografierbare Szene, Person mitten in der Tätigkeit, nicht posierend.
   - "bewegung": kurze Bewegungsnotiz für die spätere Animation.
   - "benoetigte_referenzen": Teilmenge von ["person","fahrzeug","logo","gebaeude"].
   - "volle_breite": true bei Gruppen-/Weitwinkelmotiven, sonst false.

${masterVorlage({ stil, hatPersonfoto })}

Antworte NUR als JSON, ohne Vor-/Nachtext:
{"master_prompt":"<ausgefüllte Vorlage>","saetze":[{"text":"...","zeilen":["...","..."],"schluesselwoerter":["..."],"motiv":{"titel":"...","prompt":"...","bewegung":"...","benoetigte_referenzen":["person"],"volle_breite":false}}]}`;
}

function normalisiereSatz(s, nr) {
  const text = String(s?.text || '').trim();
  let zeilen = Array.isArray(s?.zeilen) ? s.zeilen.filter(Boolean).map((z) => String(z).trim()) : [];
  if (!zeilen.length) zeilen = teileZeilen(text);
  const schluesselwoerter = Array.isArray(s?.schluesselwoerter)
    ? s.schluesselwoerter.filter(Boolean).map((w) => String(w).trim()).slice(0, 2)
    : [];
  return { nr, text, zeilen, schluesselwoerter, motiv_nr: nr, dauer_s: null };
}

function normalisiereMotiv(s, nr) {
  const m = s?.motiv || {};
  const erlaubt = ['person', 'fahrzeug', 'logo', 'gebaeude'];
  const benoetigt = Array.isArray(m.benoetigte_referenzen)
    ? m.benoetigte_referenzen.filter((r) => erlaubt.includes(r))
    : [];
  return {
    nr,
    titel: String(m.titel || `Motiv ${nr}`).trim(),
    prompt: String(m.prompt || '').trim(),
    bewegung: String(m.bewegung || '').trim(),
    benoetigte_referenzen: benoetigt,
    volle_breite: !!m.volle_breite,
    referenz_ids: [],
    bild_url: null,
    bild_quelle: null,
    freigegeben: false,
  };
}

// Haupt-Generator: liefert { skript, motive, master_prompt }.
export async function generateSkript({ kunde, jobs, anrede, stil, gehaltAnzeigen, stimmenText, hatPersonfoto }) {
  const mehrereStellen = (jobs?.length || 0) > 1;
  const hatStimme = !!(stimmenText && stimmenText.trim());
  const system = buildSystemPrompt({ anrede, stil, mehrereStellen, hatStimme, gehaltAnzeigen, hatPersonfoto });

  const userData = {
    firma: kunde?.firmenname || kunde?.name || null,
    kunde: kompakt({ ort: kunde?.ort, stadt: kunde?.stadt, branche: kunde?.branche, farben: kunde?.farben, farbe_primaer: kunde?.farbe_primaer, beschreibung: kunde?.beschreibung }),
    anrede,
    stil,
    stellen: (jobs || []).map((j) => kompakt(j)),
    mitarbeiterstimmen: hatStimme ? stimmenText : undefined,
    gehalt_anzeigen: gehaltAnzeigen,
  };

  const data = await callClaudeWithRetry({
    model: CLAUDE_MODEL,
    max_tokens: 3800,
    system,
    messages: [{ role: 'user', content: JSON.stringify(userData) }],
  });
  const parsed = parseJsonContent(data);
  const saetze = Array.isArray(parsed?.saetze) ? parsed.saetze.slice(0, SATZ_ANZAHL) : [];
  if (saetze.length < 3) throw new Error('Skript-Generierung lieferte zu wenige Sätze.');

  const skript = saetze.map((s, i) => normalisiereSatz(s, i + 1));
  const motive = saetze.map((s, i) => normalisiereMotiv(s, i + 1));

  // Fester Schlusssatz als letzter skript-Eintrag (ohne Motiv → Endkarte).
  const schluss = istDu(anrede) ? SCHLUSS_DU : SCHLUSS_SIE;
  skript.push({ nr: skript.length + 1, text: schluss, zeilen: teileZeilen(schluss), schluesselwoerter: [], motiv_nr: null, dauer_s: null });

  return { skript, motive, master_prompt: String(parsed?.master_prompt || '').trim() };
}

// Einen einzelnen Satz neu formulieren (Motiv bleibt unverändert).
export async function reformulateSatz({ kunde, jobs, anrede, stil, gehaltAnzeigen, satz, position, alleSaetze }) {
  const du = istDu(anrede);
  const system = `Formuliere GENAU EINEN Satz eines Recruiting-Reels neu. Ansprache: ${du ? 'Du' : 'Sie'}. 6–14 Wörter, 3–7 Sekunden gesprochen, Alltagssprache, keine Floskeln${gehaltAnzeigen ? '' : ', keine Gehaltszahlen'}. Der Satz steht an Position ${position} von ${SATZ_ANZAHL}.
Liefere auch "zeilen" (2–3 GROSSBUCHSTABEN-Zeilen) und "schluesselwoerter" (0–2 Wörter exakt wie im Text).
Antworte NUR als JSON: {"text":"...","zeilen":["...","..."],"schluesselwoerter":["..."]}`;
  const userData = {
    firma: kunde?.firmenname || kunde?.name || null,
    stellen: (jobs || []).map((j) => kompakt(j)),
    bisheriger_satz: satz,
    alle_saetze: (alleSaetze || []).map((s) => s.text),
  };
  const data = await callClaudeWithRetry({
    model: CLAUDE_MODEL,
    max_tokens: 500,
    system,
    messages: [{ role: 'user', content: JSON.stringify(userData) }],
  });
  const parsed = parseJsonContent(data);
  const text = String(parsed?.text || '').trim();
  if (!text) throw new Error('Keine Neuformulierung erhalten.');
  let zeilen = Array.isArray(parsed?.zeilen) ? parsed.zeilen.filter(Boolean).map((z) => String(z).trim()) : [];
  if (!zeilen.length) zeilen = teileZeilen(text);
  const schluesselwoerter = Array.isArray(parsed?.schluesselwoerter)
    ? parsed.schluesselwoerter.filter(Boolean).map((w) => String(w).trim()).slice(0, 2)
    : [];
  return { text, zeilen, schluesselwoerter };
}
