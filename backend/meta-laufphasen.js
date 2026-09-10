// Meta-Laufphasen: aus den Tages-Insights abgeleitete Aktivitätszeiträume.
//
// Eine Laufphase ist ein zusammenhängender Block aus AKTIVEN Tagen (Spend > 0).
// Eine Lücke von mehr als REAKT_SCHWELLE_TAGE Tagen ohne Aktivität beendet die Phase;
// erneute Aktivität danach startet eine NEUE Phase (= Reaktivierung). Kurze Pausen
// strecken die Phase, lange beenden sie.
//
// KERN-REGEL für alle Meilenstein-Features: gezählt werden AKTIVE LAUFTAGE (Tage mit
// Spend > 0) der AKTUELLEN Phase — nie Kalendertage, nie ab meta_start_time.

import { supabase } from './supabase.js';

export const REAKT_SCHWELLE_TAGE = 60;   // Lücke > 60 Tage beendet die Phase (konfigurierbar)
const REAKT_MELDE_FENSTER_TAGE = 21;     // Reaktivierung nur melden, wenn die neue Phase so jung ist (kein Backfill-Spam)
const AKTIV_LATENZ_TAGE = 3;             // Phase gilt als „live", wenn der letzte Aktiv-Tag so frisch ist (Reporting-Lag)

function ymd(d) { return new Date(d).toISOString().slice(0, 10); }
function tageZwischen(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000); }
function heute() { return ymd(Date.now()); }

/**
 * Rohe Phasen-Berechnung aus sortierten Aktiv-Tagen.
 * @param {string[]} aktivTage  aufsteigend sortierte 'YYYY-MM-DD' (nur Tage mit Spend > 0)
 * @param {number} schwelle     max. erlaubte Lücke in Tagen (Infinity = nie splitten)
 * @returns {{phase_start,letzter_aktiv_tag,aktive_lauftage}[]}
 */
export function berechnePhasen(aktivTage, schwelle = REAKT_SCHWELLE_TAGE) {
  const phasen = [];
  let cur = null;
  for (const tag of aktivTage) {
    if (!cur) { cur = { phase_start: tag, letzter_aktiv_tag: tag, aktive_lauftage: 1 }; continue; }
    if (tageZwischen(cur.letzter_aktiv_tag, tag) > schwelle) {
      phasen.push(cur);
      cur = { phase_start: tag, letzter_aktiv_tag: tag, aktive_lauftage: 1 };
    } else {
      cur.letzter_aktiv_tag = tag;
      cur.aktive_lauftage += 1;
    }
  }
  if (cur) phasen.push(cur);
  return phasen;
}

/** Alle Insights-Tage einer Kampagne laden (datum, spend), aufsteigend. */
async function ladeTage(metaCampaignId) {
  const { data } = await supabase.from('talentone_meta_insights')
    .select('datum, spend').eq('meta_campaign_id', metaCampaignId).order('datum', { ascending: true });
  return data || [];
}

/**
 * Laufphasen einer Kampagne aus den Insights neu berechnen und persistieren.
 * Erkennt Reaktivierungen (neue Phase nach > Schwelle Tagen Lücke) gegenüber dem
 * gespeicherten Stand. Meldet nur FRISCHE Reaktivierungen (kein Backfill-Spam).
 * @returns {{ phasen, reaktivierung: {phase_start, pause_tage}|null }}
 */
export async function laufphasenAktualisieren(metaCampaignId) {
  const [{ data: kamp }, tage, { data: bestehend }] = await Promise.all([
    supabase.from('talentone_meta_kampagnen').select('laufphasen_manuell').eq('meta_campaign_id', metaCampaignId).maybeSingle(),
    ladeTage(metaCampaignId),
    supabase.from('talentone_meta_laufphasen').select('phase_start, letzter_aktiv_tag').eq('meta_campaign_id', metaCampaignId).order('phase_start', { ascending: true }),
  ]);
  const aktivTage = tage.filter(t => Number(t.spend) > 0).map(t => t.datum);
  if (!aktivTage.length) return { phasen: [], reaktivierung: null };

  const schwelle = kamp?.laufphasen_manuell ? Infinity : REAKT_SCHWELLE_TAGE;
  const phasen = berechnePhasen(aktivTage, schwelle);

  // Spend-Summe je Phase (über alle Insight-Tage im Phasen-Zeitraum).
  const spendVon = (start, ende) => tage
    .filter(t => t.datum >= start && t.datum <= ende)
    .reduce((s, t) => s + (Number(t.spend) || 0), 0);

  // Reaktivierung: neue jüngste Phase, deren Start deutlich nach dem bisher bekannten
  // letzten Aktiv-Tag liegt — und die frisch genug ist, um sie zu melden.
  let reaktivierung = null;
  const bekannteStarts = new Set((bestehend || []).map(p => p.phase_start));
  const vorherLetzter = (bestehend || []).reduce((m, p) => (p.letzter_aktiv_tag > m ? p.letzter_aktiv_tag : m), '');
  const neueste = phasen[phasen.length - 1];
  if (bestehend?.length && neueste && !bekannteStarts.has(neueste.phase_start) && vorherLetzter
    && tageZwischen(vorherLetzter, neueste.phase_start) > REAKT_SCHWELLE_TAGE
    && tageZwischen(neueste.phase_start, heute()) <= REAKT_MELDE_FENSTER_TAGE) {
    reaktivierung = { phase_start: neueste.phase_start, pause_tage: tageZwischen(vorherLetzter, neueste.phase_start) };
  }

  // Persistieren: alte Phasen ersetzen (klein, driftfrei). Jüngste Phase = offen (phase_ende null).
  await supabase.from('talentone_meta_laufphasen').delete().eq('meta_campaign_id', metaCampaignId);
  const rows = phasen.map((p, i) => ({
    meta_campaign_id: metaCampaignId,
    phase_start: p.phase_start,
    phase_ende: i === phasen.length - 1 ? null : p.letzter_aktiv_tag,
    quelle: kamp?.laufphasen_manuell ? 'manuell' : 'auto',
    aktive_lauftage: p.aktive_lauftage,
    letzter_aktiv_tag: p.letzter_aktiv_tag,
    spend_summe: spendVon(p.phase_start, p.letzter_aktiv_tag),
    updated_at: new Date().toISOString(),
  }));
  if (rows.length) await supabase.from('talentone_meta_laufphasen').insert(rows);
  return { phasen: rows, reaktivierung };
}

/**
 * Aktuelle-Phase-Kennzahlen einer Kampagne für Anzeige + Meilenstein-Logik.
 * @param {string} metaCampaignId
 * @param {string|null} zahlungsproblemSeit  'YYYY-MM-DD' des Werbekontos (für Pausen-Aufschlüsselung)
 * @returns null wenn keine Phase, sonst { phase_start, letzter_aktiv_tag, aktive_lauftage,
 *   kalender_von, kalender_bis, pause_tage, pause_wg_zahlung, live, laufphasen_manuell }
 */
export async function aktuellePhaseInfo(metaCampaignId, zahlungsproblemSeit = null) {
  const [{ data: kamp }, tage] = await Promise.all([
    supabase.from('talentone_meta_kampagnen').select('laufphasen_manuell').eq('meta_campaign_id', metaCampaignId).maybeSingle(),
    ladeTage(metaCampaignId),
  ]);
  const aktivTage = tage.filter(t => Number(t.spend) > 0).map(t => t.datum);
  if (!aktivTage.length) return null;
  const schwelle = kamp?.laufphasen_manuell ? Infinity : REAKT_SCHWELLE_TAGE;
  const phasen = berechnePhasen(aktivTage, schwelle);
  const cur = phasen[phasen.length - 1];
  // Aktiv-Tage der aktuellen Phase (= alle Aktiv-Tage ab deren Start, da sie der letzte
  // zusammenhängende Block ist). Ermöglicht den Meilenstein-Kalendertag (N-ter Aktiv-Tag).
  const aktivTageCur = aktivTage.filter(d => d >= cur.phase_start);

  const heuteYmd = heute();
  const live = tageZwischen(cur.letzter_aktiv_tag, heuteYmd) <= AKTIV_LATENZ_TAGE;
  const kalenderBis = live ? heuteYmd : cur.letzter_aktiv_tag; // laufend → bis heute, sonst bis letztem Aktiv-Tag
  const spanTage = tageZwischen(cur.phase_start, kalenderBis) + 1;
  const pauseTage = Math.max(0, spanTage - cur.aktive_lauftage);

  // Pausentage, die auf/nach dem Zahlungsproblem-Beginn liegen (inaktive Tage im Zeitraum).
  let pauseWgZahlung = 0;
  if (zahlungsproblemSeit && zahlungsproblemSeit <= kalenderBis) {
    const aktivSet = new Set(aktivTage);
    const von = zahlungsproblemSeit > cur.phase_start ? zahlungsproblemSeit : cur.phase_start;
    for (let d = von; d <= kalenderBis; d = ymd(Date.parse(d) + 86400000)) {
      if (!aktivSet.has(d)) pauseWgZahlung++;
    }
  }

  return {
    phase_start: cur.phase_start,
    letzter_aktiv_tag: cur.letzter_aktiv_tag,
    aktive_lauftage: cur.aktive_lauftage,
    aktiv_tage: aktivTageCur,          // Kalendertage mit Spend > 0 in der aktuellen Phase
    kalender_von: cur.phase_start,
    kalender_bis: kalenderBis,
    pause_tage: pauseTage,
    pause_wg_zahlung: pauseWgZahlung,
    live,
    laufphasen_manuell: !!kamp?.laufphasen_manuell,
  };
}
