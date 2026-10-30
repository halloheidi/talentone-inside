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
- HISTORIE: Hat der Kunde eine Vorgeschichte (Altprojekte / frühere Kampagne), nimm in der Einleitung persönlich und konkret darauf Bezug.
- CLOSE-DATEN sind interne Gesprächsnotizen: zitiere sie NICHT wörtlich. Nutze nur die inhaltlichen Ergebnisse (was besprochen oder vereinbart wurde).

JSON-Schema (alle Felder liefern; Arrays notfalls leer, unbekannte Werte null):
{
  "einleitung": "persönliche Anrede-Zeile + 3-5 Sätze, Bezug auf Gespräch/Historie",
  "leistungsbeschreibung": "ein bis mehrere Absätze zu Leistung und Ablauf",
  "positionen": [
    { "titel": "kurz", "beschreibung": "1-2 Sätze", "menge": 1, "einheit": "Stk.", "einzelpreis_netto": 1490, "kategorie": "setup" }
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
kategorie ist "setup" (einmalig) oder "monthly" (monatlich wiederkehrend).`;

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
  return normalizeEntwurf(parseJsonContent(data));
}

/**
 * Nachschärfen: ändert nur das in `anweisung` Genannte, Rest bleibt.
 * @returns {Promise<object>} normalisierter, überarbeiteter Entwurf
 */
export async function refineOfferDraft({ brand, kunde, kontext = {}, entwurf, anweisung = '' } = {}) {
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
  return normalizeEntwurf(parseJsonContent(data));
}
