// Tracking-Abgleich: Tool-Bewerbungen je Stelle vs. gemeldete Meta-Events
// (Conversion-Events aus den Insights, breite action_type-Menge siehe
// meta-sync.js). Deckt auf, wo der Pixel/CAPI nicht feuert: Stellen mit
// Bewerbungen aber 0 Events.
import { supabase } from './supabase.js';

function ymd(ms) { return new Date(ms).toISOString().slice(0, 10); }
function seitTs(tage) { return ymd(Date.now() - tage * 86400000) + 'T00:00:00Z'; }

/**
 * Pro Stelle (job): Bewerbungen vs. Meta-Events im Fenster.
 * @returns Map jobId -> { tage, bewerbungen, events, spend, hat_kampagne, quote, pixel_feuert_nicht }
 */
export async function trackingFuerJobs(jobIds, tage = 14) {
  const map = new Map();
  if (!jobIds?.length) return map;
  const seitDatum = ymd(Date.now() - tage * 86400000);
  const seitTime = seitTs(tage);

  const { data: jobs = [] } = await supabase.from('talentone_jobs')
    .select('id, projekt_id').in('id', jobIds);
  const projektIds = [...new Set(jobs.map(j => j.projekt_id).filter(Boolean))];

  const [{ data: kamps = [] }, { data: adsets = [] }] = await Promise.all([
    projektIds.length ? supabase.from('talentone_meta_kampagnen').select('meta_campaign_id, projekt_id').in('projekt_id', projektIds) : Promise.resolve({ data: [] }),
    projektIds.length ? supabase.from('talentone_meta_adsets').select('meta_adset_id, projekt_id').in('projekt_id', projektIds) : Promise.resolve({ data: [] }),
  ]);
  const campByProjekt = {}, adsetByProjekt = {};
  for (const k of kamps) (campByProjekt[k.projekt_id] ||= []).push(k.meta_campaign_id);
  for (const a of adsets) (adsetByProjekt[a.projekt_id] ||= []).push(a.meta_adset_id);
  const allCamps = [...new Set(kamps.map(k => k.meta_campaign_id))];
  const allAdsets = [...new Set(adsets.map(a => a.meta_adset_id))];

  const [{ data: ci = [] }, { data: ai = [] }, { data: bews = [] }] = await Promise.all([
    allCamps.length ? supabase.from('talentone_meta_insights').select('meta_campaign_id, leads, spend').in('meta_campaign_id', allCamps).gte('datum', seitDatum) : Promise.resolve({ data: [] }),
    allAdsets.length ? supabase.from('talentone_meta_adset_insights').select('meta_adset_id, leads, spend').in('meta_adset_id', allAdsets).gte('datum', seitDatum) : Promise.resolve({ data: [] }),
    supabase.from('talentone_bewerbungen').select('job_id').in('job_id', jobIds).gte('created_at', seitTime),
  ]);
  const leadsByCamp = {}, spendByCamp = {};
  for (const r of ci) { leadsByCamp[r.meta_campaign_id] = (leadsByCamp[r.meta_campaign_id] || 0) + (r.leads || 0); spendByCamp[r.meta_campaign_id] = (spendByCamp[r.meta_campaign_id] || 0) + (Number(r.spend) || 0); }
  const leadsByAdset = {}, spendByAdset = {};
  for (const r of ai) { leadsByAdset[r.meta_adset_id] = (leadsByAdset[r.meta_adset_id] || 0) + (r.leads || 0); spendByAdset[r.meta_adset_id] = (spendByAdset[r.meta_adset_id] || 0) + (Number(r.spend) || 0); }
  const bewByJob = {};
  for (const b of bews) bewByJob[b.job_id] = (bewByJob[b.job_id] || 0) + 1;

  for (const j of jobs) {
    const camps = campByProjekt[j.projekt_id] || [];
    const asets = adsetByProjekt[j.projekt_id] || [];
    let events = 0, spend = 0;
    for (const c of camps) { events += leadsByCamp[c] || 0; spend += spendByCamp[c] || 0; }
    for (const a of asets) { events += leadsByAdset[a] || 0; spend += spendByAdset[a] || 0; }
    const bewerbungen = bewByJob[j.id] || 0;
    const hatKampagne = camps.length > 0 || asets.length > 0;
    map.set(j.id, {
      tage,
      bewerbungen,
      events,
      spend: Math.round(spend * 100) / 100,
      hat_kampagne: hatKampagne,
      quote: bewerbungen > 0 ? Math.round((events / bewerbungen) * 100) : null,
      pixel_feuert_nicht: hatKampagne && bewerbungen > 0 && events === 0,
    });
  }
  return map;
}

/** Tracking für eine einzelne Stelle (bequem für die Kachel). */
export async function trackingFuerJob(jobId, tage = 14) {
  const m = await trackingFuerJobs([jobId], tage);
  return m.get(jobId) || { tage, bewerbungen: 0, events: 0, spend: 0, hat_kampagne: false, quote: null, pixel_feuert_nicht: false };
}

/**
 * Abgleich-Report über alle aktiven Stellen (zugeordnete Kampagne ODER
 * Bewerbung im Fenster). Nur Zeilen mit Bewerbungen/Events/Spend.
 */
export async function trackingReport(tage = 14) {
  const seitTime = seitTs(tage);
  const { data: kamps = [] } = await supabase.from('talentone_meta_kampagnen')
    .select('projekt_id').not('projekt_id', 'is', null);
  const projektIds = [...new Set(kamps.map(k => k.projekt_id))];

  const { data: jobsMitProjekt = [] } = projektIds.length
    ? await supabase.from('talentone_jobs').select('id, stelle, kunde_id, projekt_id, pixel_id').in('projekt_id', projektIds)
    : { data: [] };
  const { data: bewsRecent = [] } = await supabase.from('talentone_bewerbungen').select('job_id').gte('created_at', seitTime);
  const jobIdsMitBew = new Set(bewsRecent.map(b => b.job_id));
  const bekannt = new Set(jobsMitProjekt.map(j => j.id));
  const extraIds = [...jobIdsMitBew].filter(id => id && !bekannt.has(id));
  const { data: extraJobs = [] } = extraIds.length
    ? await supabase.from('talentone_jobs').select('id, stelle, kunde_id, projekt_id, pixel_id').in('id', extraIds)
    : { data: [] };

  const alle = [...jobsMitProjekt, ...extraJobs];
  const ids = alle.map(j => j.id);
  const tracking = await trackingFuerJobs(ids, tage);

  const kundeIds = [...new Set(alle.map(j => j.kunde_id).filter(Boolean))];
  const { data: kunden = [] } = kundeIds.length
    ? await supabase.from('talentone_kunden').select('id, firmenname').in('id', kundeIds) : { data: [] };
  const kById = Object.fromEntries(kunden.map(k => [k.id, k]));

  const zeilen = alle.map(j => {
    const t = tracking.get(j.id) || {};
    return {
      job_id: j.id, stelle: j.stelle, firmenname: kById[j.kunde_id]?.firmenname || '—',
      bewerbungen: t.bewerbungen || 0, events: t.events || 0, spend: t.spend || 0,
      hat_kampagne: !!t.hat_kampagne, quote: t.quote ?? null, pixel_feuert_nicht: !!t.pixel_feuert_nicht,
    };
  }).filter(z => z.bewerbungen > 0 || z.events > 0 || z.spend > 0)
    .sort((a, b) => (a.pixel_feuert_nicht === b.pixel_feuert_nicht ? b.bewerbungen - a.bewerbungen : (a.pixel_feuert_nicht ? -1 : 1)));

  const gesamtBew = zeilen.reduce((s, z) => s + z.bewerbungen, 0);
  const gesamtEvents = zeilen.reduce((s, z) => s + z.events, 0);
  return {
    tage,
    zeilen,
    summary: {
      gesamt_bewerbungen: gesamtBew,
      gesamt_events: gesamtEvents,
      quote: gesamtBew > 0 ? Math.round((gesamtEvents / gesamtBew) * 100) : null,
      pixel_feuert_nicht: zeilen.filter(z => z.pixel_feuert_nicht),
    },
  };
}

/**
 * Wächter für die tägliche Sammel-Mail: Stellen mit Bewerbungen im Fenster,
 * aber 0 Meta-Events (Pixel feuert nicht) — Default 3 Tage.
 */
export async function pixelWaechter(tage = 3) {
  const rep = await trackingReport(tage);
  return rep.summary.pixel_feuert_nicht.map(z => ({
    job_id: z.job_id, stelle: z.stelle, firmenname: z.firmenname,
    bewerbungen: z.bewerbungen, events: z.events, tage,
  }));
}
