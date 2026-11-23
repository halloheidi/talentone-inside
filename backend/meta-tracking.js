// Tracking-Abgleich: Tool-Bewerbungen je Stelle vs. gemeldete Meta-Events.
// Zwei präzise, action-basierte Stufen (aus dem actions-jsonb der Insights,
// Migration 121):
//   1. „Pixel feuert nicht"          — aktive Kampagne mit Spend > 0 im Fenster,
//                                       aber KEINE offsite_conversion.fb_pixel_*-Action
//                                       (der Pixel meldet gar nichts).
//   2. „Pixel feuert, aber keine Bewerbung" — fb_pixel_*-Actions vorhanden, aber
//                                       KEINE fb_pixel_custom-Conversion (die Bewerbung)
//                                       bei Spend > 50 € (Pixel sendet, aber nicht die
//                                       Bewerbungs-Conversion).
import { supabase } from './supabase.js';

function ymd(ms) { return new Date(ms).toISOString().slice(0, 10); }
function seitTs(tage) { return ymd(Date.now() - tage * 86400000) + 'T00:00:00Z'; }

// Pixel-Actions aus dem actions-Array: alle offsite_conversion.fb_pixel_* (Pixel feuert
// überhaupt) und speziell fb_pixel_custom (die Bewerbungs-Custom-Conversion).
const istPixelAction = (t) => typeof t === 'string' && t.startsWith('offsite_conversion.fb_pixel_');
const istCustomConversion = (t) => typeof t === 'string' && t.includes('fb_pixel_custom');
function pixelWerte(actions) {
  let pixel = 0, custom = 0;
  if (Array.isArray(actions)) {
    for (const a of actions) {
      const v = Number(a?.value) || 0;
      if (istPixelAction(a?.action_type)) pixel += v;
      if (istCustomConversion(a?.action_type)) custom += v;
    }
  }
  return { pixel, custom };
}
const istAktiv = (status) => /ACTIVE/i.test(String(status || ''));
const PIXEL_OHNE_BEWERBUNG_MIN_SPEND = 50; // € Mindest-Spend für Stufe 2

/**
 * Pro Stelle (job): Bewerbungen vs. Meta-Events/-Actions im Fenster.
 * @returns Map jobId -> {
 *   tage, bewerbungen, events, spend, hat_kampagne, aktiv, quote,
 *   hat_pixel_action, hat_custom_conversion,
 *   pixel_feuert_nicht, pixel_ohne_bewerbung
 * }
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
    projektIds.length ? supabase.from('talentone_meta_kampagnen').select('meta_campaign_id, projekt_id, effective_status').in('projekt_id', projektIds).eq('ignoriert', false) : Promise.resolve({ data: [] }),
    projektIds.length ? supabase.from('talentone_meta_adsets').select('meta_adset_id, projekt_id, effective_status').in('projekt_id', projektIds) : Promise.resolve({ data: [] }),
  ]);
  const campByProjekt = {}, adsetByProjekt = {};
  const campAktiv = {}, adsetAktiv = {};
  for (const k of kamps) { (campByProjekt[k.projekt_id] ||= []).push(k.meta_campaign_id); campAktiv[k.meta_campaign_id] = istAktiv(k.effective_status); }
  for (const a of adsets) { (adsetByProjekt[a.projekt_id] ||= []).push(a.meta_adset_id); adsetAktiv[a.meta_adset_id] = istAktiv(a.effective_status); }
  const allCamps = [...new Set(kamps.map(k => k.meta_campaign_id))];
  const allAdsets = [...new Set(adsets.map(a => a.meta_adset_id))];

  const [{ data: ci = [] }, { data: ai = [] }, { data: bews = [] }] = await Promise.all([
    allCamps.length ? supabase.from('talentone_meta_insights').select('meta_campaign_id, leads, spend, actions').in('meta_campaign_id', allCamps).gte('datum', seitDatum) : Promise.resolve({ data: [] }),
    allAdsets.length ? supabase.from('talentone_meta_adset_insights').select('meta_adset_id, leads, spend, actions').in('meta_adset_id', allAdsets).gte('datum', seitDatum) : Promise.resolve({ data: [] }),
    supabase.from('talentone_bewerbungen').select('job_id').in('job_id', jobIds).gte('created_at', seitTime),
  ]);
  const leadsByCamp = {}, spendByCamp = {}, pixelByCamp = {}, customByCamp = {};
  for (const r of ci) {
    leadsByCamp[r.meta_campaign_id] = (leadsByCamp[r.meta_campaign_id] || 0) + (r.leads || 0);
    spendByCamp[r.meta_campaign_id] = (spendByCamp[r.meta_campaign_id] || 0) + (Number(r.spend) || 0);
    const w = pixelWerte(r.actions);
    pixelByCamp[r.meta_campaign_id] = (pixelByCamp[r.meta_campaign_id] || 0) + w.pixel;
    customByCamp[r.meta_campaign_id] = (customByCamp[r.meta_campaign_id] || 0) + w.custom;
  }
  const leadsByAdset = {}, spendByAdset = {}, pixelByAdset = {}, customByAdset = {};
  for (const r of ai) {
    leadsByAdset[r.meta_adset_id] = (leadsByAdset[r.meta_adset_id] || 0) + (r.leads || 0);
    spendByAdset[r.meta_adset_id] = (spendByAdset[r.meta_adset_id] || 0) + (Number(r.spend) || 0);
    const w = pixelWerte(r.actions);
    pixelByAdset[r.meta_adset_id] = (pixelByAdset[r.meta_adset_id] || 0) + w.pixel;
    customByAdset[r.meta_adset_id] = (customByAdset[r.meta_adset_id] || 0) + w.custom;
  }
  const bewByJob = {};
  for (const b of bews) bewByJob[b.job_id] = (bewByJob[b.job_id] || 0) + 1;

  for (const j of jobs) {
    const camps = campByProjekt[j.projekt_id] || [];
    const asets = adsetByProjekt[j.projekt_id] || [];
    let events = 0, spend = 0, pixelActions = 0, customConv = 0, aktiv = false;
    for (const c of camps) {
      events += leadsByCamp[c] || 0; spend += spendByCamp[c] || 0;
      pixelActions += pixelByCamp[c] || 0; customConv += customByCamp[c] || 0;
      if (campAktiv[c]) aktiv = true;
    }
    for (const a of asets) {
      events += leadsByAdset[a] || 0; spend += spendByAdset[a] || 0;
      pixelActions += pixelByAdset[a] || 0; customConv += customByAdset[a] || 0;
      if (adsetAktiv[a]) aktiv = true;
    }
    const bewerbungen = bewByJob[j.id] || 0;
    const hatKampagne = camps.length > 0 || asets.length > 0;
    const spendRund = Math.round(spend * 100) / 100;
    const hatPixelAction = pixelActions > 0;
    const hatCustomConversion = customConv > 0;
    map.set(j.id, {
      tage,
      bewerbungen,
      events,
      spend: spendRund,
      hat_kampagne: hatKampagne,
      aktiv,
      quote: bewerbungen > 0 ? Math.round((events / bewerbungen) * 100) : null,
      hat_pixel_action: hatPixelAction,
      hat_custom_conversion: hatCustomConversion,
      // Stufe 1: aktive Kampagne, Spend läuft, aber der Pixel meldet keine einzige Action.
      pixel_feuert_nicht: aktiv && spendRund > 0 && !hatPixelAction,
      // Stufe 2: Pixel feuert (fb_pixel_*), aber keine Bewerbungs-Conversion (fb_pixel_custom)
      //          trotz nennenswertem Spend.
      pixel_ohne_bewerbung: hatPixelAction && !hatCustomConversion && spendRund > PIXEL_OHNE_BEWERBUNG_MIN_SPEND,
    });
  }
  return map;
}

/** Tracking für eine einzelne Stelle (bequem für die Kachel). */
export async function trackingFuerJob(jobId, tage = 14) {
  const m = await trackingFuerJobs([jobId], tage);
  return m.get(jobId) || {
    tage, bewerbungen: 0, events: 0, spend: 0, hat_kampagne: false, aktiv: false, quote: null,
    hat_pixel_action: false, hat_custom_conversion: false, pixel_feuert_nicht: false, pixel_ohne_bewerbung: false,
  };
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
      hat_kampagne: !!t.hat_kampagne, aktiv: !!t.aktiv, quote: t.quote ?? null,
      hat_pixel_action: !!t.hat_pixel_action, hat_custom_conversion: !!t.hat_custom_conversion,
      pixel_feuert_nicht: !!t.pixel_feuert_nicht, pixel_ohne_bewerbung: !!t.pixel_ohne_bewerbung,
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
      pixel_ohne_bewerbung: zeilen.filter(z => z.pixel_ohne_bewerbung),
    },
  };
}

/**
 * Wächter für die tägliche Sammel-Mail, Default 7 Tage:
 *   „Pixel feuert nicht" — aktive Kampagne, Spend > 0, keine fb_pixel_*-Action.
 */
export async function pixelWaechter(tage = 7) {
  const rep = await trackingReport(tage);
  return rep.summary.pixel_feuert_nicht.map(z => ({
    job_id: z.job_id, stelle: z.stelle, firmenname: z.firmenname,
    bewerbungen: z.bewerbungen, events: z.events, spend: z.spend, tage,
  }));
}

/**
 * Wächter Stufe 2, Default 7 Tage:
 *   „Pixel feuert, aber keine Bewerbung" — fb_pixel_*-Actions vorhanden, aber keine
 *   fb_pixel_custom-Conversion bei Spend > 50 €.
 */
export async function pixelOhneBewerbungWaechter(tage = 7) {
  const rep = await trackingReport(tage);
  return rep.summary.pixel_ohne_bewerbung.map(z => ({
    job_id: z.job_id, stelle: z.stelle, firmenname: z.firmenname,
    bewerbungen: z.bewerbungen, spend: z.spend, tage,
  }));
}
