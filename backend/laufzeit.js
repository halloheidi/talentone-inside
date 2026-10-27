// A3: Laufzeit-/Vertragsstatus je Projekt.
//
// Zwei Modelle (talentone_projekte.vertragsmodell):
//  - 'kampagne': Laufzeit zählt AKTIVE LAUFTAGE (Spend > 0) der zugeordneten Meta-Ebene
//    (siehe aktiveLauftage() in meta-laufphasen.js). Kein Kalender.
//  - 'abo': Laufzeit zählt KALENDER-Monate ab start_datum, abzüglich bestätigter Pausen.
//
// Rein additiv/lesend — ändert keine Daten.

import { supabase } from './supabase.js';
import { aktiveLauftage } from './meta-laufphasen.js';

const NICHT_RECRUITING = new Set(['neukundengewinnung', 'sonstiges', 'video']);
const MS_TAG = 86400000;
const TAGE_PRO_MONAT = 30.4375;

function heute() { return new Date(); }
function parseDatum(d) { return d ? new Date(d) : null; }
function tageDiff(a, b) { return Math.max(0, Math.round((b - a) / MS_TAG)); }
function addMonate(d, n) { const r = new Date(d); r.setMonth(r.getMonth() + n); return r; }
function ymd(d) { return d.toISOString().slice(0, 10); }

// Summe der Pausen-Tage (offene Pause bis heute gerechnet).
function pausenTage(pausen) {
  const jetzt = heute();
  let summe = 0;
  for (const p of (pausen || [])) {
    const von = parseDatum(p.von); if (!von) continue;
    const bis = p.bis ? parseDatum(p.bis) : jetzt;
    summe += tageDiff(von, bis);
  }
  return summe;
}

/**
 * @param {object} projekt  Zeile aus talentone_projekte (inkl. vertragsmodell,
 *   laufzeit_wert, laufzeit_einheit, start_datum, pausen, garantie)
 * @returns {{modell, soll, verbraucht, rest, einheit, ende_voraussichtlich,
 *   pausen, pausen_tage, garantie, hinweise:string[]}}
 */
export async function laufzeitStatus(projekt) {
  const modell = projekt?.vertragsmodell || null;
  const pausen = Array.isArray(projekt?.pausen) ? projekt.pausen : [];
  const garantie = !!projekt?.garantie;
  const hinweise = [];
  const ptage = pausenTage(pausen);
  const base = { modell, pausen, pausen_tage: ptage, garantie, hinweise, soll: null, verbraucht: null, rest: null, ueberlaufzeit_tage: null, einheit: null, ende_voraussichtlich: null, open_end: false, online_tage: null };

  if (!modell) { hinweise.push('kein_vertragsmodell'); return base; }

  // ── Kampagne: aktive Lauftage der zugeordneten Meta-Ebene ──────────────────
  if (modell === 'kampagne') {
    base.einheit = projekt.laufzeit_einheit || 'tage';
    base.soll = projekt.laufzeit_wert ?? null;

    // Vertragsfenster: ab start_datum zählen. Fehlt es → Fallback = aktuelle Laufphase
    // (all-time-Verhalten), Hinweis 'start_datum_fehlt'.
    const abDatum = projekt.start_datum || null;
    if (!abDatum) hinweise.push('start_datum_fehlt');

    const { data: jobs = [] } = await supabase.from('talentone_jobs')
      .select('id, projekttyp').eq('projekt_id', projekt.id);
    const recruiting = jobs.filter(j => !NICHT_RECRUITING.has(j.projekttyp || ''));
    if (!recruiting.length) { hinweise.push('keine_meta_verbindung'); return base; }

    let maxLauftage = null, hatVerbindung = false, datenFehlen = false;
    // Parallel statt sequenziell — die Meta-Queries je Job laufen gleichzeitig.
    const rs = await Promise.all(recruiting.map(j => aktiveLauftage(j.id, { abDatum }).catch(() => ({ quelle: 'keine' }))));
    for (const r of rs) {
      if (r.quelle === 'keine') continue;
      hatVerbindung = true;
      if (r.hinweis === 'meta_daten_fehlen') datenFehlen = true;
      if (r.lauftage != null) maxLauftage = Math.max(maxLauftage ?? 0, r.lauftage);
    }
    if (!hatVerbindung) { hinweise.push('keine_meta_verbindung'); return base; }
    if (datenFehlen && maxLauftage == null) { hinweise.push('meta_daten_fehlen'); return base; }

    base.verbraucht = maxLauftage ?? 0;
    if (base.soll != null) {
      if (base.verbraucht > base.soll) {
        // Kulanz-Weiterlauf: nie negativ; Überlaufzeit separat ausweisen.
        base.rest = 0;
        base.ueberlaufzeit_tage = base.verbraucht - base.soll;
        hinweise.push('ueberlaufzeit');
      } else {
        base.rest = base.soll - base.verbraucht;
      }
    }
    // Ende ist bei Kampagnen aktiv-tag-basiert, kein Kalenderdatum → bewusst null.
    return base;
  }

  // ── Abo: Kalender-Monate ab start_datum, minus Pausen ──────────────────────
  if (modell === 'abo') {
    base.einheit = projekt.laufzeit_einheit || 'monate';
    base.soll = projekt.laufzeit_wert ?? null;    // Monate (null = offene Laufzeit)
    const start = parseDatum(projekt.start_datum);
    if (!start) { hinweise.push('kein_start_datum'); if (garantie) hinweise.push('abo_mit_garantie'); return base; }

    const jetzt = heute();
    const bruttoTage = tageDiff(start, jetzt);
    const nettoTage = Math.max(0, bruttoTage - ptage);
    base.verbraucht = Math.round((nettoTage / TAGE_PRO_MONAT) * 10) / 10;   // Monate (1 Dezimale)
    base.online_tage = nettoTage;                 // Kalendertage online (minus Pausen)
    base.open_end = (base.soll == null);          // Abo ohne feste Laufzeit = läuft monatlich bis Kündigung

    if (base.soll != null) {
      base.rest = Math.round((base.soll - base.verbraucht) * 10) / 10;
      // Ende = Start + Laufzeit (in Einheit) + Summe Pausen (Tage).
      const einheitMonate = (base.einheit === 'monate');
      const endeOhnePause = einheitMonate ? addMonate(start, base.soll) : new Date(start.getTime() + base.soll * MS_TAG);
      base.ende_voraussichtlich = ymd(new Date(endeOhnePause.getTime() + ptage * MS_TAG));
    }
    if (garantie) hinweise.push('abo_mit_garantie');   // Garantie bei Abo ist ungewöhnlich → Warnung (nicht blockierend)
    return base;
  }

  return base;
}
