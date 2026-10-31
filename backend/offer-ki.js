// KI-gestützte Angebots-Erstellung ("Individuell mit KI").
// Nutzt den bestehenden Claude-Wrapper (claude.js, Anthropic, claude-sonnet-4-6)
// und erzeugt ein STRUKTURIERTES Angebot als JSON — kein Fließtext-Dump.
// Downstream bleibt unverändert: der erzeugte Entwurf wird im Frontend editiert
// und am Ende über denselben POST /api/offers-Pfad (positionen_snapshot + Felder)
// gespeichert. Dieses Modul speichert/liest selbst nichts aus der DB.

import { callClaudeWithRetry, parseJsonContent } from './claude.js';
import { anredePromptHinweis } from './anrede.js';

const CLAUDE_MODEL = 'claude-sonnet-4-6';

const VERTRAGSMODELLE = new Set(['kampagne', 'abo']);
const LAUFZEIT_EINHEITEN = new Set(['tage', 'monate']);
const GARANTIE_ARTEN = new Set(['hire', 'applications']);
const POSITION_KATEGORIEN = new Set(['setup', 'monthly']);

const SYSTEM_LEITPLANKEN = (brandLabel, anredeHinweis) => `Du bist Angebots-Texter für ${brandLabel}, eine Recruiting-Agentur für Mitarbeitergewinnung. Du schreibst ein konkretes Angebot für einen Kunden.

Antworte AUSSCHLIESSLICH mit einem einzigen JSON-Objekt. Kein Fließtext davor oder danach, keine Markdown-Backticks.

Harte Leitplanken (immer einhalten):
- PREISE: Setze einen Einzelpreis (einzelpreis_netto, netto in Euro) NUR, wenn er aus einem angehakten Baustein stammt ODER im Freitext ausdrücklich genannt wird. In JEDEM anderen Fall ist einzelpreis_netto = null UND es kommt ein Eintrag in "offene_punkte" (z.B. "Preis für Fotograf-Vor-Ort fehlt"). Erfinde niemals Preise.
- KEINE Zusagen zu Bewerbungszahlen oder Einstellungen im Fließtext (einleitung/leistungsbeschreibung). Solche Zusagen gehören ausschließlich in vertrag.garantie_* und nur, wenn eine Garantie ausdrücklich vereinbart wurde.
- ANREDE: ${anredeHinweis}. Durchgängig in allen Texten.
- WORDING: niemals das Wort "kostenlos" verwenden; keine Werbeplattform-Namen nennen (Meta, Facebook, Instagram, TikTok); das Erstgespräch heißt "Strategiegespräch".
- HISTORIE: Hat der Kunde eine Vorgeschichte (Altprojekte / frühere Kampagne), nimm sie NUR als sachliche Fakten auf (welche Stellen, welcher Zeitraum, welches Ergebnis). Der Kundentext erwähnt NIEMALS Konflikte, Zahlungs-/Geld-Historie, Mahnungen, Rechnungsstreitigkeiten, Beschwerden, Kündigungen, Abbrüche oder Unzufriedenheit — weder direkt noch angedeutet ("Unklarheiten", "Neustart nach den Problemen" o.ä. sind verboten).
- KEINE BEHAUPTETEN ABSPRACHEN: Formulierungen wie "wie besprochen", "wie vereinbart", "wie zugesagt", "wie abgestimmt" NUR verwenden, wenn der Freitext eine solche Absprache ausdrücklich enthält. Sonst neutral formulieren ("gerne bieten wir Ihnen an …").
- GARANTIE: Setze vertrag.garantie_art NUR, wenn der Freitext eine Garantie ausdrücklich nennt. Sagt der Freitext "keine Garantie" o.ä., ist garantie_art=null. Schweigt der Freitext zur Garantie, ist garantie_art=null und es kommt ein offener Punkt "Garantie gewünscht? (keine / Einstellung / Bewerbungen)". Abo + Garantie ist ausdrücklich zulässig (z.B. "6 Einstellungen → 6 Monate Abo mit Einstellungsgarantie").
- CLOSE-DATEN sind interne Gesprächsnotizen: zitiere sie NICHT wörtlich. Nutze nur unkritische inhaltliche Ergebnisse (siehe HISTORIE).
- OPTIONALE POSITIONEN: Erkenne im Freitext "optional", "zubuchbar", "auf Wunsch" → setze für diese Position optional=true. Optionale Positionen haben einen Preis, zählen aber NICHT zur Angebotssumme.

JSON-Schema (alle Felder liefern; Arrays notfalls leer, unbekannte Werte null):
{
  "einleitung": "persönliche Anrede-Zeile + 3-5 Sätze, Bezug auf Gespräch/Historie (nur sachliche Fakten)",
  "leistungsbeschreibung": "ein bis mehrere Absätze zu Leistung und Ablauf",
  "positionen": [
    { "titel": "kurz", "beschreibung": "1-2 Sätze", "menge": 1, "einheit": "Stk.", "einzelpreis_netto": 1490, "kategorie": "setup", "optional": false }
  ],
  "vertrag": {
    "vertragsmodell": "kampagne" | "abo" | null,
    "laufzeit_wert": 6,
    "laufzeit_einheit": "monate" | "tage" | null,
    "garantie_art": "hire" | "applications" | null,
    "garantie_ziel": 1,
    "garantie_position": "Freitext der Garantie oder null"
  },
  "zahlungsbedingungen": "Freitext oder leer",
  "gueltig_bis": "YYYY-MM-DD oder null",
  "offene_punkte": ["kurze Hinweise auf fehlende Angaben"]
}
kategorie ist "setup" (einmalig) oder "monthly" (monatlich wiederkehrend). optional ist true/false.`;

function brandLabel(brand) {
  return brand === 'nowag_wirth' ? 'Nowag & Wirth' : 'TalentOne';
}

// Serialisiert den (frontendseitig schon gefilterten) Kontext in kompakten Text.
function renderKontext({ kontext = {}, closeEintraege = [], freitext = '', bausteine = [] }) {
  const k = kontext || {};
  const lines = [];

  const kunde = k.kunde || {};
  lines.push('## Kunde');
  lines.push(`Firma: ${kunde.firmenname || kunde.firma || '-'}`);
  if (kunde.branche) lines.push(`Branche: ${kunde.branche}`);
  if (kunde.ansprechpartner) lines.push(`Ansprechpartner: ${kunde.ansprechpartner}`);

  if (Array.isArray(k.stellen) && k.stellen.length) {
    lines.push('\n## Aktuelle Stellen');
    for (const s of k.stellen) {
      lines.push(`- ${s.stelle || s.titel || '-'}${s.region ? ` (${s.region})` : ''}${s.status ? ` — Status: ${s.status}` : ''}`);
    }
  }
  if (Array.isArray(k.altprojekte) && k.altprojekte.length) {
    lines.push('\n## Frühere Projekte / Historie');
    for (const p of k.altprojekte) {
      const zeit = [p.von, p.bis].filter(Boolean).join('–');
      lines.push(`- ${p.stelle || p.projekt || '-'}${zeit ? ` (${zeit})` : ''}${p.status ? ` — ${p.status}` : ''}${p.ergebnis ? ` — Ergebnis: ${p.ergebnis}` : ''}`);
    }
  }
  if (k.vertrag && (k.vertrag.vertragsmodell || k.vertrag.laufzeit_wert || k.vertrag.garantie)) {
    const v = k.vertrag;
    const g = v.garantie ? ` — Garantie: ${v.garantie}` : '';
    lines.push('\n## Bisheriger Vertrag');
    lines.push(`Modell: ${v.vertragsmodell || '-'}${v.laufzeit_wert ? `, Laufzeit ${v.laufzeit_wert} ${v.laufzeit_einheit || ''}` : ''}${g}`);
  }
  if (Number(k.mitarbeiterstimmen_anzahl) > 0) lines.push(`\nMitarbeiterstimmen vorhanden: ${k.mitarbeiterstimmen_anzahl}`);
  if (Number(k.referenzbilder_anzahl) > 0) lines.push(`Referenzbilder vorhanden: ${k.referenzbilder_anzahl}`);

  if (Array.isArray(bausteine) && bausteine.length) {
    lines.push('\n## Angehakte Bausteine (Preise sind VERBINDLICH für die Positionen)');
    for (const b of bausteine) {
      const preis = (b.unit_price ?? b.einzelpreis_netto);
      lines.push(`- ${b.title || b.titel || '-'}: ${preis != null ? `${preis} € netto` : 'Preis offen'}${b.category || b.kategorie ? ` [${b.category || b.kategorie}]` : ''}${b.description ? ` — ${b.description}` : ''}`);
    }
  }

  if (Array.isArray(closeEintraege) && closeEintraege.length) {
    lines.push('\n## Gesprächskontext (intern, nur Inhalte nutzen, nicht zitieren)');
    for (const e of closeEintraege) {
      lines.push(`- [${e.date || ''}] ${e.title || e.type || ''}: ${e.excerpt || ''}`);
    }
  }

  lines.push('\n## Was das Angebot enthalten soll (Freitext des Vertriebs)');
  lines.push(String(freitext || '').trim() || '(kein Freitext angegeben)');

  return lines.join('\n');
}

function coerceNummer(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Bringt die KI-Antwort in die kanonische, sichere Form (keine Fantasiepreise,
// gültige Enums, Arrays garantiert). offene_punkte wird ggf. um fehlende Preise
// ergänzt, falls die KI das versäumt hat.
export function normalizeEntwurf(parsed) {
  const p = parsed || {};
  const positionenRaw = Array.isArray(p.positionen) ? p.positionen : [];
  const offene = new Set((Array.isArray(p.offene_punkte) ? p.offene_punkte : []).map(x => String(x || '').trim()).filter(Boolean));

  const offeneHatTitel = (titel) => {
    const t = titel.toLowerCase();
    for (const o of offene) if (o.toLowerCase().includes(t)) return true;
    return false;
  };
  const positionen = positionenRaw.map((l) => {
    const titel = String(l?.titel || l?.title || '').trim();
    const preis = l?.einzelpreis_netto === null || l?.einzelpreis_netto === undefined || l?.einzelpreis_netto === ''
      ? null
      : coerceNummer(l.einzelpreis_netto);
    // Fehlender Preis = offener Punkt — aber nur, wenn die KI ihn nicht ohnehin
    // schon (anders formuliert) genannt hat.
    if (preis === null && titel && !offeneHatTitel(titel)) offene.add(`Preis für „${titel}" fehlt`);
    const kat = POSITION_KATEGORIEN.has(l?.kategorie) ? l.kategorie : 'setup';
    return {
      titel,
      beschreibung: String(l?.beschreibung || l?.description || ''),
      menge: Math.max(1, Math.floor(coerceNummer(l?.menge) || 1)),
      einheit: String(l?.einheit || 'Stk.').trim() || 'Stk.',
      einzelpreis_netto: preis,
      kategorie: kat,
      optional: !!l?.optional,
    };
  }).filter(l => l.titel);

  const v = p.vertrag || {};
  const vertrag = {
    vertragsmodell: VERTRAGSMODELLE.has(v.vertragsmodell) ? v.vertragsmodell : null,
    laufzeit_wert: coerceNummer(v.laufzeit_wert),
    laufzeit_einheit: LAUFZEIT_EINHEITEN.has(v.laufzeit_einheit) ? v.laufzeit_einheit : null,
    garantie_art: GARANTIE_ARTEN.has(v.garantie_art) ? v.garantie_art : null,
    garantie_ziel: coerceNummer(v.garantie_ziel),
    garantie_position: v.garantie_position ? String(v.garantie_position).trim() : null,
  };

  let gueltig = null;
  if (p.gueltig_bis && /^\d{4}-\d{2}-\d{2}$/.test(String(p.gueltig_bis).slice(0, 10))) {
    gueltig = String(p.gueltig_bis).slice(0, 10);
  }

  return {
    einleitung: String(p.einleitung || '').trim(),
    leistungsbeschreibung: String(p.leistungsbeschreibung || '').trim(),
    positionen,
    vertrag,
    zahlungsbedingungen: String(p.zahlungsbedingungen || '').trim(),
    gueltig_bis: gueltig,
    offene_punkte: Array.from(offene),
  };
}

// Behauptete Absprachen & Garantie-Steuerung.
const ABSPRACHE_CLAIM = /\b(wie\s+(bereits\s+)?(besprochen|vereinbart|zugesagt|abgestimmt)|wie\s+telefonisch\s+besprochen)\b/i;
const ABSPRACHE_BELEG = /(besproch|vereinbart|zugesagt|abgestimmt|telefon|gespräch|gespraech|call|meeting|termin|kennengelernt)/i;
const GARANTIE_FREITEXT = /(garantie|garantiert|einstellungsgarantie|bewerbungsgarantie|bis zur (ersten )?einstellung)/i;
const GARANTIE_VERNEINT = /((keine|ohne)\s+garantie|garantie\s+(raus|weg|entfernen|nicht|streichen))/i;

/**
 * Setzt die inhaltlichen Leitplanken nach der Generierung durch:
 *  - behauptete Absprachen ohne Freitext-Beleg → offener Punkt,
 *  - (nur bei enforceGarantie) Garantie nur, wenn der Freitext sie nennt.
 */
export function enforceLeitplanken(entwurf, freitext = '', { enforceGarantie = true } = {}) {
  const ft = String(freitext || '');
  const offene = new Set(entwurf.offene_punkte || []);

  const text = `${entwurf.einleitung || ''}\n${entwurf.leistungsbeschreibung || ''}`;
  if (ABSPRACHE_CLAIM.test(text) && !ABSPRACHE_BELEG.test(ft)) {
    offene.add('Das Angebot behauptet eine Absprache ("wie besprochen/vereinbart"), die der Freitext nicht belegt — bitte prüfen oder neutral formulieren.');
  }

  if (enforceGarantie) {
    const v = entwurf.vertrag || (entwurf.vertrag = {});
    const verneint = GARANTIE_VERNEINT.test(ft);
    const genannt = GARANTIE_FREITEXT.test(ft) && !verneint;
    if (!genannt) {
      v.garantie_art = null; v.garantie_ziel = null; v.garantie_position = null;
      if (!verneint) offene.add('Garantie gewünscht? (keine / Einstellung / Bewerbungen)');
    }
  }

  entwurf.offene_punkte = Array.from(offene);
  return entwurf;
}

// Close-Einträge, deren INHALT nicht in Kundentext gehört (Zahlungsverzug,
// Mahnung, strittige Rechnung, Beschwerde, Kündigung, Abbruch, Unzufriedenheit).
const CLOSE_RISIKO = /(mahnung|zahlungsverzug|verzug|inkasso|offene\s+(rechnung|posten)|überfällig|ueberfaellig|nicht\s+(be)?zahlt|zahlungserinnerung|rechnungsstreit|strittige?\s+rechnung|reklamation|beschwerde|unzufrieden|enttäusch|enttaeusch|kündig|kuendig|vertragsabbruch|abbruch|abgebrochen|rechtsanwalt|\banwalt|rückerstattung|ruckerstattung|geld\s+zurück|storno)/i;

function keywordKlass(e) {
  const hay = `${e.title || ''} ${e.excerpt || ''}`;
  const m = hay.match(CLOSE_RISIKO);
  return m ? { verwendbar: false, grundLabel: m[0].trim() } : { verwendbar: true, grundLabel: null };
}
function formatGrund(label, date) {
  if (!label) return null;
  const l = label.charAt(0).toUpperCase() + label.slice(1);
  const monat = date ? ` (${String(date).slice(0, 7)})` : '';
  return `${l}${monat}`;
}

/**
 * Klassifiziert Close-Einträge: welche sind inhaltlich in Kundentext verwendbar?
 * Deterministische Keyword-Baseline + optionale KI-Verfeinerung (eine Anfrage).
 * Keyword-Veto bleibt immer bestehen (sicherer). Rückgabe: Einträge + { verwendbar, grund }.
 */
export async function classifyCloseEntries(entries = []) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return [];
  const base = list.map(e => { const k = keywordKlass(e); return { ...e, verwendbar: k.verwendbar, grundLabel: k.grundLabel }; });

  let merged = base;
  try {
    const kompakt = list.map((e, i) => `#${i} [${e.date || ''}] ${e.type || ''}: ${String(e.title || '')} — ${String(e.excerpt || '').slice(0, 300)}`).join('\n');
    const data = await callClaudeWithRetry({
      model: CLAUDE_MODEL, max_tokens: 1500,
      system: 'Du klassifizierst interne CRM-Einträge daraufhin, ob ihr Inhalt in einem Kunden-Angebotstext sachlich verwendbar ist. NICHT verwendbar (false) sind Einträge über Zahlungsverzug, Mahnung, offene/strittige Rechnungen, Beschwerden, Kündigung, Vertragsabbruch oder Unzufriedenheit. Antworte NUR als JSON {"items":[{"i":0,"verwendbar":true,"grund":null}]}. grund ist bei false ein kurzes internes Label (z.B. "Zahlungsthema"), sonst null.',
      messages: [{ role: 'user', content: kompakt }],
    });
    const parsed = parseJsonContent(data);
    const byI = new Map((parsed.items || []).map(x => [Number(x.i), x]));
    merged = base.map((e, i) => {
      const v = byI.get(i);
      const verwendbar = e.verwendbar !== false && (!v || v.verwendbar !== false);
      const grundLabel = verwendbar ? null : (e.grundLabel || (v && v.grund) || 'nur intern');
      return { ...e, verwendbar, grundLabel };
    });
  } catch (err) {
    console.warn('[offer-ki/classifyCloseEntries]', err.message);
  }

  return merged.map(e => ({
    id: e.id, type: e.type, date: e.date, title: e.title, excerpt: e.excerpt,
    verwendbar: e.verwendbar,
    grund: e.verwendbar ? null : formatGrund(e.grundLabel, e.date),
  }));
}

/**
 * Erstgenerierung eines Angebots-Entwurfs.
 * @returns {Promise<object>} normalisierter Entwurf (siehe normalizeEntwurf)
 */
export async function generateOfferDraft({ brand, kunde, kontext = {}, closeEintraege = [], freitext = '', bausteine = [] } = {}) {
  const anredeHinweis = anredePromptHinweis(kunde || kontext?.kunde || {});
  const system = SYSTEM_LEITPLANKEN(brandLabel(brand), anredeHinweis);
  const heute = new Date().toISOString().slice(0, 10);
  const user = `Heutiges Datum: ${heute}. Verwende nur Daten (gueltig_bis, Startdatum) in der Zukunft, ausgehend von heute.\n\nErstelle einen Angebots-Entwurf auf Basis des folgenden Kontexts.\n\n${renderKontext({ kontext, closeEintraege, freitext, bausteine })}`;

  const data = await callClaudeWithRetry({
    model: CLAUDE_MODEL,
    max_tokens: 3000,
    system,
    messages: [{ role: 'user', content: user }],
  });
  return enforceLeitplanken(normalizeEntwurf(parseJsonContent(data)), freitext, { enforceGarantie: true });
}

/**
 * Entwirft die Begleit-E-Mail zum Angebot (Betreff + Body). Gleicher Kontext wie
 * das Angebot: Freitext, gefilterte Close-Einträge, Anrede. Der Annahme-Button
 * wird NICHT in den Body geschrieben (fügt die Mail-Funktion automatisch an).
 * @returns {Promise<{subject:string, body:string}>}
 */
export async function generateOfferMail({ brand, kunde, freitext = '', closeEintraege = [], positionen = [], vertrag = {}, gueltigBis = null, absenderName = '' } = {}) {
  const anredeHinweis = anredePromptHinweis(kunde || {});
  const label = brandLabel(brand);
  const system = `Du schreibst die kurze Begleit-E-Mail zu einem Angebot von ${label}, einer Recruiting-Agentur. Antworte AUSSCHLIESSLICH mit einem JSON-Objekt {"subject": "...", "body": "..."} — keine Markdown-Backticks.

Regeln:
- Anrede: ${anredeHinweis}. Durchgängig.
- body: 5–8 Sätze in Absätzen (\\n\\n getrennt): kurzer Bezug auf das Gespräch, was im Angebot steckt (2–3 Stichpunkte, jeweils mit "• " am Zeilenanfang), Gültigkeit, Hinweis "über den Button unten können Sie das Angebot ansehen und direkt annehmen", freundlicher Abschluss.
- Schließe mit einer Signatur: ${absenderName ? `"${absenderName}" + "${label}"` : `"Ihr Team von ${label}"`}.
- Wording: niemals "kostenlos"; keine Plattformnamen (Meta, Facebook, Instagram, TikTok); Erstgespräch = "Strategiegespräch".
- Erwähne NIEMALS Konflikte, Zahlungs-/Geld-Historie oder Probleme. Historie nur als sachliche Fakten.
- Nenne KEINE konkreten Preise im Fließtext (die stehen im Angebot). Füge den Button/Link NICHT selbst ein.`;
  const inhalt = (positionen || []).map(p => `- ${p.titel || p.title}${p.optional ? ' (optional)' : ''}`).join('\n');
  const user = `Freitext (Vertrieb): ${freitext || '-'}
Im Angebot enthalten:
${inhalt || '-'}
Vertrag: ${vertrag?.vertragsmodell || '-'}${vertrag?.laufzeit_wert ? `, Laufzeit ${vertrag.laufzeit_wert} ${vertrag.laufzeit_einheit || ''}` : ''}
Gültig bis: ${gueltigBis || '-'}
${(closeEintraege || []).length ? 'Gesprächskontext (nur unkritische Inhalte nutzen, nicht zitieren):\n' + closeEintraege.map(e => `- ${e.title}: ${e.excerpt}`).join('\n') : ''}`;
  const data = await callClaudeWithRetry({ model: CLAUDE_MODEL, max_tokens: 1200, system, messages: [{ role: 'user', content: user }] });
  const p = parseJsonContent(data);
  return { subject: String(p.subject || 'Ihr Angebot').trim(), body: String(p.body || '').trim() };
}

/**
 * Nachschärfen: ändert nur das in `anweisung` Genannte, Rest bleibt.
 * @returns {Promise<object>} normalisierter, überarbeiteter Entwurf
 */
export async function refineOfferDraft({ brand, kunde, kontext = {}, entwurf, anweisung = '', freitext = '' } = {}) {
  const anredeHinweis = anredePromptHinweis(kunde || kontext?.kunde || {});
  const system = SYSTEM_LEITPLANKEN(brandLabel(brand), anredeHinweis);
  const heute = new Date().toISOString().slice(0, 10);
  const user = `Heutiges Datum: ${heute}. Verwende nur Daten in der Zukunft.\n\nHier ist der aktuelle Angebots-Entwurf als JSON:\n\n${JSON.stringify(entwurf || {}, null, 2)}\n\nÄndere AUSSCHLIESSLICH das Folgende und lass alles andere unverändert:\n"${String(anweisung || '').trim()}"\n\nGib den vollständigen, überarbeiteten Entwurf im selben JSON-Schema zurück.`;

  const data = await callClaudeWithRetry({
    model: CLAUDE_MODEL,
    max_tokens: 3000,
    system,
    messages: [{ role: 'user', content: user }],
  });
  // Absprachen-Check gegen Freitext+Anweisung; Garantie NICHT neu erzwingen
  // (Refine soll eine zuvor gesetzte Garantie nicht ungewollt entfernen).
  return enforceLeitplanken(normalizeEntwurf(parseJsonContent(data)), `${freitext}\n${anweisung}`, { enforceGarantie: false });
}
