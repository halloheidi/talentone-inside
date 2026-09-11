// Meta-Kennzahlen für Budget-Wächter, Garantie-Wächter und Controlling/CPL.
// Baut auf Laufphasen (aktive Lauftage) + Tages-Insights auf. Alle Beträge in EUR
// (talentone_meta_insights.spend ist bereits in Kontowährung/EUR, keine Minor-Units).

import { supabase } from './supabase.js';
import { aktuellePhaseInfo } from './meta-laufphasen.js';

function ymd(d) { return new Date(d).toISOString().slice(0, 10); }
export function monatsStart(d = new Date()) { const x = new Date(d); return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-01`; }

/** meta_campaign_ids eines Projekts (alle zugeordneten Kampagnen). */
async function kampagnenIdsFuerProjekt(projektId) {
  const { data } = await supabase.from('talentone_meta_kampagnen')
    .select('meta_campaign_id, werbekonto_id').eq('projekt_id', projektId);
  return data || [];
}

/** Spend-Summe eines Projekts über alle zugeordneten Kampagnen im Zeitraum [von,bis]. */
export async function spendImZeitraum(campaignIds, von, bis) {
  if (!campaignIds.length) return 0;
  const { data } = await supabase.from('talentone_meta_insights')
    .select('spend').in('meta_campaign_id', campaignIds).gte('datum', von).lte('datum', bis);
  return (data || []).reduce((s, r) => s + (Number(r.spend) || 0), 0);
}

/** Aggregierte Kennzahlen (spend/impressions/clicks/ctr) im Zeitraum. */
export async function metrikenImZeitraum(campaignIds, von, bis) {
  if (!campaignIds.length) return { spend: 0, impressions: 0, clicks: 0, ctr: null };
  const { data } = await supabase.from('talentone_meta_insights')
    .select('spend, impressions, clicks').in('meta_campaign_id', campaignIds).gte('datum', von).lte('datum', bis);
  let spend = 0, impressions = 0, clicks = 0;
  for (const r of (data || [])) { spend += Number(r.spend) || 0; impressions += Number(r.impressions) || 0; clicks += Number(r.clicks) || 0; }
  const ctr = impressions > 0 ? (clicks / impressions) * 100 : null;
  return { spend, impressions, clicks, ctr };
}

/**
 * Monats-Auslastung eines Projekts: Spend des laufenden Kalendermonats ÷ Monatsbudget.
 * @returns null wenn kein Budget gesetzt (→ Wächter bleibt stumm), sonst
 *   { budget, spend, prozent, von, bis }.
 */
export async function budgetAuslastung(projekt, heute = new Date()) {
  const budget = Number(projekt.monatsbudget_euro);
  if (!budget || budget <= 0) return null;
  const kamps = await kampagnenIdsFuerProjekt(projekt.id);
  const von = monatsStart(heute), bis = ymd(heute);
  const spend = await spendImZeitraum(kamps.map(k => k.meta_campaign_id), von, bis);
  return { budget, spend, prozent: Math.round((spend / budget) * 100), von, bis };
}

/* ── Garantie ─────────────────────────────────────────────────────────────────
   Reale Daten (talentone_projekte.garantie bool + garantie_details text):
   - „Erfolgsgarantie 30 Tage — kostenlose Weiterarbeit bis zur ersten Einstellung."
     (Standardfall) → Fenster = 30 (aktive) Lauftage bis zur ersten Einstellung.
   - Zahlvarianten „1 Einstellung in 30 Tagen", „… sonst 30 Tage Verlängerung" → ebenfalls 30.
   - Mengen-Zusagen ohne Tageszahl („1 Bauhelfer", „2 Tischler", „3 Bewerbungen qualifiziert")
     → keine Tages-Frist ableitbar → Fenster-Warnung entfällt (nur Status wird gemeldet).
   Regel: erste im Text gefundene Zahl unmittelbar vor „Tag/Tage/Tagen" = Fenster in
   aktiven Lauftagen; sonst, wenn garantie=true, Default 30; sonst kein Fenster. */
export function garantieFensterTage(garantieDetails) {
  const m = String(garantieDetails || '').match(/(\d+)\s*Tag/i);
  if (m) return Number(m[1]);
  return null; // keine explizite Tageszahl
}

/**
 * Garantie-Status eines Projekts auf Basis aktiver Lauftage der aktuellen Phase.
 * @returns { hat, text, fenster_tage, aktive_lauftage, rest_tage, laeuft_aus,
 *            phase1, phase2 } — laeuft_aus = Fenster endet in ≤14 aktiven Lauftagen.
 */
export function garantieStatus(projekt, aktiveLauftage) {
  if (!projekt.garantie) return { hat: false };
  const explizit = garantieFensterTage(projekt.garantie_details);
  const fenster = explizit ?? 30; // Standard-Erfolgsgarantie 30 Tage
  const rest = aktiveLauftage != null ? fenster - aktiveLauftage : null;
  return {
    hat: true,
    text: projekt.garantie_details || 'Erfolgsgarantie (30 Tage)',
    fenster_tage: fenster,
    explizites_fenster: explizit != null,
    aktive_lauftage: aktiveLauftage ?? null,
    rest_tage: rest,
    laeuft_aus: rest != null && rest > 0 && rest <= 14,
    phase1: projekt.phase1_einstellungen || null,
    phase2: projekt.phase2_einstellungen || null,
  };
}

/* ── Controlling/CPL — Batch-Kennzahlen je Projekt ───────────────────────────
   Effizient über Bulk-Queries (unabhängig von der Projektanzahl): eine Kampagnen-,
   eine Laufphasen-, eine Insights-, eine Jobs- und eine Bewerbungs-Query. Nutzt die
   PERSISTIERTEN Laufphasen (kein Neuberechnen). CPL = Spend der aktuellen Phase ÷
   ECHTE Bewerbungen (talentone_bewerbungen des verknüpften Jobs seit Phasenstart) —
   NICHT Metas Lead-Zahl. Kunden/Projekte ohne Meta-Verknüpfung sind NICHT im Ergebnis
   (Aufrufer zeigt „—", nicht 0). */
const AKTIV_LATENZ_TAGE = 3;
function tageDiff(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000); }

export async function metaMetrikenBatch(projektIds, heute = new Date()) {
  const map = new Map();
  if (!projektIds?.length) return map;
  const heuteY = ymd(heute), monatY = monatsStart(heute);

  const { data: kamps } = await supabase.from('talentone_meta_kampagnen')
    .select('meta_campaign_id, projekt_id, werbekonto_id, name, effective_status').in('projekt_id', projektIds);
  if (!kamps?.length) return map;
  const campIds = kamps.map(k => k.meta_campaign_id);
  const projektVonCamp = {}; const campsVonProjekt = {};
  for (const k of kamps) { projektVonCamp[k.meta_campaign_id] = k.projekt_id; (campsVonProjekt[k.projekt_id] ||= []).push(k.meta_campaign_id); }

  // Aktuelle Phase je Kampagne aus den persistierten Laufphasen.
  const { data: phasen } = await supabase.from('talentone_meta_laufphasen')
    .select('meta_campaign_id, phase_start, phase_ende, letzter_aktiv_tag, aktive_lauftage').in('meta_campaign_id', campIds);
  const curPhase = {}; // camp → aktuelle Phase
  for (const p of (phasen || [])) {
    const e = curPhase[p.meta_campaign_id];
    // offen (phase_ende null) hat Vorrang, sonst jüngster phase_start
    if (!e || (p.phase_ende === null && e.phase_ende !== null) || (p.phase_ende === e.phase_ende && p.phase_start > e.phase_start)) {
      curPhase[p.meta_campaign_id] = p;
    }
  }
  const campMeta = {}; for (const k of kamps) campMeta[k.meta_campaign_id] = k;

  // Alle Insights der beteiligten Kampagnen (Datensatz ist klein) — je Kampagne indiziert.
  const { data: ins } = await supabase.from('talentone_meta_insights')
    .select('meta_campaign_id, datum, spend, impressions, clicks').in('meta_campaign_id', campIds);
  const insByCamp = {}; for (const r of (ins || [])) (insByCamp[r.meta_campaign_id] ||= []).push(r);

  // Jobs je Projekt + Bewerbungen je Job (für CPL).
  const { data: jobs } = await supabase.from('talentone_jobs').select('id, projekt_id').in('projekt_id', projektIds);
  const jobsVonProjekt = {}; const alleJobIds = [];
  for (const j of (jobs || [])) { (jobsVonProjekt[j.projekt_id] ||= []).push(j.id); alleJobIds.push(j.id); }
  let bew = [];
  if (alleJobIds.length) {
    const { data } = await supabase.from('talentone_bewerbungen').select('job_id, created_at, ko_kriterium').in('job_id', alleJobIds);
    bew = data || [];
  }
  const projektVonJob = {}; for (const j of (jobs || [])) projektVonJob[j.id] = j.projekt_id;

  // Budget je Projekt.
  const { data: pj } = await supabase.from('talentone_projekte').select('id, monatsbudget_euro').in('id', projektIds);
  const budgetVonProjekt = {}; for (const p of (pj || [])) budgetVonProjekt[p.id] = p.monatsbudget_euro != null ? Number(p.monatsbudget_euro) : null;

  // IST-Livegang je Projekt = frühester Phasen-Start über alle Kampagnen (erster Spend-Tag
  // der ersten Laufphase).
  const istVonProjekt = {};
  for (const p of (phasen || [])) {
    const pid = projektVonCamp[p.meta_campaign_id]; if (!pid) continue;
    if (!istVonProjekt[pid] || p.phase_start < istVonProjekt[pid]) istVonProjekt[pid] = p.phase_start;
  }

  // Zahlungsproblem je Projekt = irgendein zugeordnetes Werbekonto betroffen.
  const kontoIds = [...new Set(kamps.map(k => String(k.werbekonto_id || '').trim()).filter(Boolean))];
  const zahlungKonto = {};
  if (kontoIds.length) {
    const { data: kt } = await supabase.from('talentone_meta_konten').select('konto_id, zahlungsproblem').in('konto_id', kontoIds);
    for (const k of (kt || [])) zahlungKonto[String(k.konto_id).trim()] = !!k.zahlungsproblem;
  }
  const zahlungVonProjekt = {};
  for (const k of kamps) {
    const pid = k.projekt_id;
    if (zahlungKonto[String(k.werbekonto_id || '').trim()]) zahlungVonProjekt[pid] = true;
  }

  const RECENT_TAGE = 60; // Kampagnen dieses „Laufs" — letzter Aktiv-Tag höchstens so alt
  const tagVor = n => ymd(Date.parse(heuteY) - n * 86400000);
  const since7 = tagVor(6), since28 = tagVor(27); // inkl. heute → 7- bzw. 28-Tage-Fenster

  for (const pid of projektIds) {
    const camps = campsVonProjekt[pid]; if (!camps?.length) continue; // keine Meta-Verknüpfung → nicht im Ergebnis
    // Kampagnen des aktuellen Laufs: aktuelle Phase existiert UND letzter Aktiv-Tag ≤60 T.
    const usable = camps.filter(c => curPhase[c] && curPhase[c].letzter_aktiv_tag && tageDiff(curPhase[c].letzter_aktiv_tag, heuteY) <= RECENT_TAGE);
    const lauf = usable.length ? usable : camps.filter(c => curPhase[c]); // Fallback: irgendeine Phase
    // Lauftage ab dem FRÜHESTEN aktiven Phasenstart (nicht der jüngsten Kampagne).
    const aktuellePhaseStart = lauf.length ? lauf.map(c => curPhase[c].phase_start).sort()[0] : null;
    const live = lauf.some(c => tageDiff(curPhase[c].letzter_aktiv_tag, heuteY) <= AKTIV_LATENZ_TAGE);

    // Spend/Insights SUMMIEREN über alle Kampagnen des Projekts; Aktiv-Tage als Union.
    const spendByTag = {};
    let spendMonat = 0, spendPhase = 0, spend7 = 0, spend28 = 0, imprPhase = 0, clicksPhase = 0;
    const spendWochen = [0, 0, 0, 0, 0, 0, 0, 0];
    for (const c of camps) {
      for (const r of (insByCamp[c] || [])) {
        const sp = Number(r.spend) || 0;
        spendByTag[r.datum] = (spendByTag[r.datum] || 0) + sp;
        if (r.datum >= monatY && r.datum <= heuteY) spendMonat += sp;
        if (aktuellePhaseStart && r.datum >= aktuellePhaseStart && r.datum <= heuteY) { spendPhase += sp; imprPhase += Number(r.impressions) || 0; clicksPhase += Number(r.clicks) || 0; }
        if (r.datum >= since7 && r.datum <= heuteY) spend7 += sp;
        if (r.datum >= since28 && r.datum <= heuteY) spend28 += sp;
        const wz = Math.floor(tageDiff(r.datum, heuteY) / 7);
        if (wz >= 0 && wz < 8) spendWochen[7 - wz] += sp;
      }
    }
    const aktivTage = Object.keys(spendByTag).filter(d => spendByTag[d] > 0);
    const aktiveLauftageGesamt = aktivTage.length;
    const aktiveLauftage = aktuellePhaseStart ? aktivTage.filter(d => d >= aktuellePhaseStart && d <= heuteY).length : 0;

    // Bewerbungen des Projekts (job-basiert) über die Fenster + KO + Wochen-Sparkline.
    const projBews = bew.filter(b => projektVonJob[b.job_id] === pid);
    const dOf = b => String(b.created_at).slice(0, 10);
    const bewPhase = aktuellePhaseStart ? projBews.filter(b => dOf(b) >= aktuellePhaseStart).length : null;
    const bew7 = projBews.filter(b => dOf(b) >= since7).length;
    const bew28 = projBews.filter(b => dOf(b) >= since28).length;
    const ohneKo = aktuellePhaseStart ? projBews.filter(b => dOf(b) >= aktuellePhaseStart && !b.ko_kriterium).length : null;
    const bewWochen = [0, 0, 0, 0, 0, 0, 0, 0];
    for (const b of projBews) { const wz = Math.floor(tageDiff(dOf(b), heuteY) / 7); if (wz >= 0 && wz < 8) bewWochen[7 - wz]++; }

    const budget = budgetVonProjekt[pid] ?? null;
    // Kampagnen-Details (aufklappbar), aufsteigend nach Start.
    const kampagnen = lauf.map(c => {
      const ph = curPhase[c], cm = campMeta[c] || {};
      let sp = 0; for (const r of (insByCamp[c] || [])) { if (ph.phase_start && r.datum >= ph.phase_start) sp += Number(r.spend) || 0; }
      return { name: cm.name || c, phase_start: ph.phase_start, spend: sp, effective_status: cm.effective_status || null, aktive_lauftage: ph.aktive_lauftage, live: tageDiff(ph.letzter_aktiv_tag, heuteY) <= AKTIV_LATENZ_TAGE };
    }).sort((a, b) => String(a.phase_start).localeCompare(String(b.phase_start)));

    map.set(pid, {
      hat_meta: true,
      spend_monat: spendMonat, spend_phase: spendPhase,
      impressions: imprPhase, clicks: clicksPhase,
      ctr: imprPhase > 0 ? (clicksPhase / imprPhase) * 100 : null,
      bewerbungen: bewPhase, ohne_ko: ohneKo,
      cpl: (aktuellePhaseStart && bewPhase > 0) ? spendPhase / bewPhase : null,
      cpl_7t: bew7 > 0 ? spend7 / bew7 : null,
      cpl_28t: bew28 > 0 ? spend28 / bew28 : null,
      bewerbungen_7t: bew7, bewerbungen_28t: bew28,
      aktive_lauftage: aktiveLauftage, aktive_lauftage_gesamt: aktiveLauftageGesamt,
      live, phase_start: aktuellePhaseStart, ist_livegang: istVonProjekt[pid] || null,
      zahlungsproblem: !!zahlungVonProjekt[pid],
      spend_wochen: spendWochen, bewerbungen_wochen: bewWochen,
      budget, budget_prozent: budget && budget > 0 ? Math.round((spendMonat / budget) * 100) : null,
      anzahl_kampagnen: lauf.length,
      anzahl_aktive: lauf.filter(c => tageDiff(curPhase[c].letzter_aktiv_tag, heuteY) <= AKTIV_LATENZ_TAGE).length,
      kampagnen,
    });
  }
  return map;
}

/** Kompakte Meta-Kennzahlen eines einzelnen Projekts (für den Job-Kopf). */
export async function metaMetrikenFuerProjekt(projektId, heute = new Date()) {
  const m = await metaMetrikenBatch([projektId], heute);
  return m.get(projektId) || null;
}

/**
 * Aktuelle Kampagne eines Projekts (live bevorzugt, sonst jüngster Aktiv-Tag) + Phase.
 * Gemeinsame Auswahl-Logik für Reminder/Controlling/Garantie.
 * @returns { kampagne, phase } | null
 */
export async function aktuelleKampagneFuerProjekt(projektId, zSeitByKonto = {}) {
  const { data: kamps } = await supabase.from('talentone_meta_kampagnen')
    .select('meta_campaign_id, name, werbekonto_id').eq('projekt_id', projektId);
  let best = null;
  for (const k of (kamps || [])) {
    const info = await aktuellePhaseInfo(k.meta_campaign_id, zSeitByKonto[String(k.werbekonto_id || '').trim()] || null);
    if (!info) continue;
    const rang = info.live ? 2 : 1;
    if (!best || rang > best.rang || (rang === best.rang && String(info.letzter_aktiv_tag) > String(best.phase.letzter_aktiv_tag))) {
      best = { rang, kampagne: k, phase: info };
    }
  }
  return best ? { kampagne: best.kampagne, phase: best.phase } : null;
}
