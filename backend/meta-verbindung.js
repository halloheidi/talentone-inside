// Live-Wächter „keine Kampagnenverbindung" (A2).
//
// Diagnostiziert je Projekt, ob eine NUTZBARE Meta-Verbindung besteht: mindestens ein
// Job des Projekts zeigt (explizit über jobs.meta_zuordnung ODER über den Reverse-FK-
// Fallback meta_kampagnen.job_id / meta_adsets.job_id) auf ein Meta-Objekt, das AKTIV
// ist und frische Insights liefert. Konsistent zu aktiveLauftage() in meta-laufphasen.js.
//
// Banner-Auslöser (nur für LIVE-Projekte, Aufrufer filtert): keine Verbindung ODER
// zugeordnetes Objekt nicht ACTIVE → „Keine Meta-Verbindung — Laufzeit wird nicht gezählt".
// Zusätzlich für den täglichen Wächter: Verbindung vorhanden, aber keine Insights > 3 Tage.

import { supabase } from './supabase.js';

const AKTIV = (s) => /ACTIVE/i.test(s || '');
function tageSeit(d) { return d ? Math.floor((Date.now() - Date.parse(d)) / 86400000) : null; }

/**
 * @param {string[]} projektIds
 * @returns {Map<string, {verbunden, aktiv, insights_frisch, insights_alter_tage,
 *   letzte_insights, objekte, banner_grund}>}
 *   banner_grund ∈ 'keine_verbindung' | 'objekt_pausiert' | null
 */
export async function metaVerbindungBatch(projektIds) {
  const ids = [...new Set((projektIds || []).filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;

  const { data: jobs = [] } = await supabase.from('talentone_jobs')
    .select('id, projekt_id, meta_zuordnung').in('projekt_id', ids);
  const jobsByProjekt = {};
  for (const j of jobs) (jobsByProjekt[j.projekt_id] ||= []).push(j);
  const jobIds = jobs.map(j => j.id);

  // Reverse-FK-Quellen (für Jobs ohne explizite Zuordnung).
  const [{ data: kamps = [] }, { data: adsets = [] }] = await Promise.all([
    jobIds.length ? supabase.from('talentone_meta_kampagnen')
      .select('meta_campaign_id, job_id, effective_status').in('job_id', jobIds).eq('gemischt', false) : { data: [] },
    jobIds.length ? supabase.from('talentone_meta_adsets')
      .select('meta_adset_id, job_id, effective_status').in('job_id', jobIds) : { data: [] },
  ]);
  const kampByJob = {}; for (const k of kamps) (kampByJob[k.job_id] ||= []).push(k);
  const adsetByJob = {}; for (const a of adsets) (adsetByJob[a.job_id] ||= []).push(a);

  // Alle referenzierten Objekt-IDs (explizit + reverse) für Status + Insights.
  const campIds = new Set(), adsetIds = new Set();
  for (const j of jobs) {
    const z = j.meta_zuordnung;
    if (z?.id && z.ebene === 'kampagne') campIds.add(String(z.id));
    else if (z?.id && z.ebene === 'anzeigengruppe') adsetIds.add(String(z.id));
  }
  for (const k of kamps) campIds.add(k.meta_campaign_id);
  for (const a of adsets) adsetIds.add(a.meta_adset_id);

  const campStatus = {}; for (const k of kamps) campStatus[k.meta_campaign_id] = k.effective_status;
  const adsetStatus = {}; for (const a of adsets) adsetStatus[a.meta_adset_id] = a.effective_status;
  // effective_status für explizit zugeordnete Objekte, die nicht per job_id gefunden wurden.
  const fehlCamps = [...campIds].filter(c => !(c in campStatus));
  const fehlAdsets = [...adsetIds].filter(a => !(a in adsetStatus));
  if (fehlCamps.length) {
    const { data } = await supabase.from('talentone_meta_kampagnen').select('meta_campaign_id, effective_status').in('meta_campaign_id', fehlCamps);
    for (const k of (data || [])) campStatus[k.meta_campaign_id] = k.effective_status;
  }
  if (fehlAdsets.length) {
    const { data } = await supabase.from('talentone_meta_adsets').select('meta_adset_id, effective_status').in('meta_adset_id', fehlAdsets);
    for (const a of (data || [])) adsetStatus[a.meta_adset_id] = a.effective_status;
  }

  // Jüngster Spend-Tag je Objekt (Insights-Frische).
  const letzteCamp = {}, letzteAdset = {};
  if (campIds.size) {
    const { data } = await supabase.from('talentone_meta_insights').select('meta_campaign_id, datum, spend').in('meta_campaign_id', [...campIds]).gt('spend', 0);
    for (const r of (data || [])) if (!letzteCamp[r.meta_campaign_id] || r.datum > letzteCamp[r.meta_campaign_id]) letzteCamp[r.meta_campaign_id] = r.datum;
  }
  if (adsetIds.size) {
    const { data } = await supabase.from('talentone_meta_adset_insights').select('meta_adset_id, datum, spend').in('meta_adset_id', [...adsetIds]).gt('spend', 0);
    for (const r of (data || [])) if (!letzteAdset[r.meta_adset_id] || r.datum > letzteAdset[r.meta_adset_id]) letzteAdset[r.meta_adset_id] = r.datum;
  }

  for (const pid of ids) {
    const objekte = [];
    for (const j of (jobsByProjekt[pid] || [])) {
      const z = j.meta_zuordnung;
      if (z?.id && z.ebene === 'kampagne') {
        const id = String(z.id);
        objekte.push({ ebene: 'kampagne', id, effective_status: campStatus[id] ?? null, letzte_insights: letzteCamp[id] ?? null, quelle: 'zuordnung' });
      } else if (z?.id && z.ebene === 'anzeigengruppe') {
        const id = String(z.id);
        objekte.push({ ebene: 'anzeigengruppe', id, effective_status: adsetStatus[id] ?? null, letzte_insights: letzteAdset[id] ?? null, quelle: 'zuordnung' });
      } else {
        for (const k of (kampByJob[j.id] || [])) objekte.push({ ebene: 'kampagne', id: k.meta_campaign_id, effective_status: campStatus[k.meta_campaign_id] ?? null, letzte_insights: letzteCamp[k.meta_campaign_id] ?? null, quelle: 'reverse_fk' });
        for (const a of (adsetByJob[j.id] || [])) objekte.push({ ebene: 'anzeigengruppe', id: a.meta_adset_id, effective_status: adsetStatus[a.meta_adset_id] ?? null, letzte_insights: letzteAdset[a.meta_adset_id] ?? null, quelle: 'reverse_fk' });
      }
    }
    const verbunden = objekte.length > 0;
    const aktiv = objekte.some(o => AKTIV(o.effective_status));
    const letzte = objekte.map(o => o.letzte_insights).filter(Boolean).sort().pop() || null;
    const insights_alter_tage = tageSeit(letzte);
    const insights_frisch = insights_alter_tage != null && insights_alter_tage <= 3;
    const banner_grund = !verbunden ? 'keine_verbindung' : (!aktiv ? 'objekt_pausiert' : null);
    out.set(pid, { verbunden, aktiv, insights_frisch, insights_alter_tage, letzte_insights: letzte, objekte, banner_grund });
  }
  return out;
}

// Kurztext für UI/Mail je Banner-Grund.
export function metaVerbindungText(grund) {
  if (grund === 'keine_verbindung') return 'Keine Meta-Verbindung — Laufzeit wird nicht gezählt';
  if (grund === 'objekt_pausiert') return 'Zugeordnete Meta-Kampagne/-Anzeigengruppe ist nicht aktiv — Laufzeit wird nicht gezählt';
  return null;
}
