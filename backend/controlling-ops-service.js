// Operatives Controlling ("Wo brennt es?") — reine Rechenfunktionen, damit sie
// testbar sind. Die Route (routes/controlling-ops.js) lädt die Daten und ruft
// diese Helfer auf. Bewusst getrennt vom Finanz-Controlling (controlling-service.js).

// ── Zentrale Ampel-Schwellen (hier zentral konfigurierbar) ─────────────────
export const AMPEL_CONFIG = {
  keineBewerbungTage:    3,    // 🔴 0 Bewerbungen in den letzten X Tagen
  sollBewerbungenProTag: 1,    // grobe Soll-Rate pro Live-Tag
  rotUnterSollFaktor:    0.5,  // < 50 % vom Soll seit Live-Start → 🔴 "deutlich unter Soll"
  unterSollAbTag:        7,    // "unter Soll" erst ab X Live-Tagen bewerten (Karenz für frische Kampagnen)
  gelbRuecklaufFaktor:   0.5,  // aktuelle Woche < 50 % der Vorwoche → 🟡 rückläufig
  phase1TageDefault:     30,   // Phase-1-Ziel, wenn keine Projektdauer hinterlegt
};

const BERLIN_TZ = 'Europe/Berlin';
const WD_INDEX = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
export const WOCHENTAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

const _fmtCache = new Intl.DateTimeFormat('en-GB', {
  timeZone: BERLIN_TZ, weekday: 'short', hourCycle: 'h23', hour: '2-digit',
  year: 'numeric', month: '2-digit', day: '2-digit',
});

// Zerlegt einen ISO-Timestamp in Berlin-lokale Teile (für Wochentag/Uhrzeit/Tagesschlüssel).
export function berlinParts(iso) {
  const parts = Object.fromEntries(_fmtCache.formatToParts(new Date(iso)).map(p => [p.type, p.value]));
  return {
    hour: parseInt(parts.hour, 10) % 24,
    weekday: WD_INDEX[parts.weekday] ?? 0,   // 0 = Mo … 6 = So
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

// Projektdauer-Freitext → Soll-Laufzeit in Tagen (null = laufend/Abo, kein festes Ende).
export function parseSollTage(projektdauer, fallback = AMPEL_CONFIG.phase1TageDefault) {
  if (!projektdauer) return fallback;
  const s = String(projektdauer).toLowerCase().trim();
  if (s.includes('abo') || s.includes('laufend') || s.includes('individuell')) return null;
  const m = s.match(/(\d+)/);
  if (!m) return fallback;
  const n = parseInt(m[1], 10);
  if (s.includes('monat')) return n * 30;
  if (s.includes('woche')) return n * 7;
  return n; // Tage
}

// Ganze Tage zwischen zwei Zeitpunkten (fromIso in der Vergangenheit → positive Zahl).
export function tageSeit(fromIso, now = new Date()) {
  if (!fromIso) return null;
  const diff = now.getTime() - new Date(fromIso).getTime();
  return Math.floor(diff / 86400000);
}

/**
 * Ampel-Bewertung eines Projekts. Reine Funktion.
 * @param {object} m
 *   status                 — Projekt-Status
 *   liveTag                — Tage seit Live-Start (null wenn kein Start)
 *   sollTage               — Soll-Laufzeit (null = Abo/laufend)
 *   letzteBewerbungTage    — Tage seit letzter Bewerbung (null = noch keine)
 *   bewerbungenSeitLive    — Bewerbungen seit Live-Start (gesamt)
 *   letzte7                — Bewerbungen letzte 7 Tage
 *   vorwoche               — Bewerbungen Tag 8–14
 * @returns {{ampel:'rot'|'gelb'|'gruen'|'grau', grund:string}}
 */
export function computeAmpel(m, cfg = AMPEL_CONFIG) {
  if (m.status !== 'live') return { ampel: 'grau', grund: 'Nicht live' };

  const gruende = [];

  // 🔴 — 0 Bewerbungen in den letzten X Tagen ODER deutlich unter Soll.
  // Karenz: eine frische Kampagne (Tag < keineBewerbungTage) ohne Bewerbung ist
  // NICHT sofort rot — es zählen die Tage ohne Eingang (bzw. die bisherige
  // Live-Laufzeit, wenn noch nie eine Bewerbung kam).
  const tageOhne = m.letzteBewerbungTage != null ? m.letzteBewerbungTage : m.liveTag;
  const keineBewerbung = tageOhne != null && tageOhne >= cfg.keineBewerbungTage;
  if (keineBewerbung) {
    gruende.push(m.letzteBewerbungTage == null
      ? `Noch keine Bewerbung (Tag ${m.liveTag})`
      : `Seit ${m.letzteBewerbungTage} Tagen keine Bewerbung`);
  }
  const bewertbareLiveTage = m.liveTag != null
    ? Math.max(1, m.sollTage != null ? Math.min(m.liveTag + 1, m.sollTage) : m.liveTag + 1)
    : 0;
  const erwartet = cfg.sollBewerbungenProTag * bewertbareLiveTage;
  const unterSoll = (m.liveTag ?? 0) >= cfg.unterSollAbTag
    && erwartet > 0
    && m.bewerbungenSeitLive != null
    && m.bewerbungenSeitLive < erwartet * cfg.rotUnterSollFaktor;
  if (unterSoll && !keineBewerbung) {
    gruende.push(`Deutlich unter Soll (${m.bewerbungenSeitLive}/${Math.round(erwartet)})`);
  }
  if (keineBewerbung || unterSoll) return { ampel: 'rot', grund: gruende.join(' · ') };

  // 🟡 — rückläufiger Eingang ODER Laufzeit überschritten
  const ruecklauf = m.vorwoche > 0 && m.letzte7 < m.vorwoche * cfg.gelbRuecklaufFaktor;
  if (ruecklauf) gruende.push(`Rückläufig (${m.letzte7} vs. ${m.vorwoche} Vorwoche)`);
  const ueberLaufzeit = m.sollTage != null && m.liveTag != null && m.liveTag > m.sollTage;
  if (ueberLaufzeit) gruende.push(`Laufzeit überschritten (Tag ${m.liveTag}/${m.sollTage})`);
  if (ruecklauf || ueberLaufzeit) return { ampel: 'gelb', grund: gruende.join(' · ') };

  return { ampel: 'gruen', grund: 'Läuft normal' };
}

// Sortier-Rang: 🔴 zuerst, dann 🟡, 🟢, grau.
export const AMPEL_RANG = { rot: 0, gelb: 1, gruen: 2, grau: 3 };

// Status-Gruppen für den Filter.
export const STATUS_GRUPPEN = {
  live:  ['live'],
  aktiv: ['live', 'onboarding', 'vorbereitung', 'warte_auf_go', 'feedbackschleife'],
  alle:  null, // kein Filter
};
