// Auto-Sync: Status aus dem Kampagnen-Tool (Creatives, Adcopies, Funnel,
// Versand, Review, Formular, Fotos) zurück in die Projekt-Checkliste.

import { supabase } from './supabase.js';

const SYNC_KEYS = [
  'creatives_erstellt', 'adcopies_geschrieben', 'bewerberliste_erstellt',
  'url_connected', 'entwuerfe_verschickt', 'go_vom_kunden',
  'formular_erhalten', 'onboarding_formular', 'fotos_erhalten',
];

/**
 * Berechnet die auto-setzbaren Checkliste-Flags für einen verknüpften
 * TalentOne-Kunden. Liefert ein Object mit { key: true } NUR für Flags,
 * die auto-getriggert wurden. Manuelle Checkboxen bleiben unangefasst.
 */
export async function computeAutoChecklist(kundeId) {
  if (!kundeId) return {};
  const out = {};

  // Alle Jobs des Kunden — alle Sub-Tabellen joinen wir manuell
  const { data: jobs } = await supabase
    .from('talentone_jobs').select('id, formdata_komplett').eq('kunde_id', kundeId);
  if (!jobs || !jobs.length) return out;
  const jobIds = jobs.map(j => j.id);

  // Formular ausgefüllt → kunde-status oder formdata_komplett vorhanden
  const { data: kunde } = await supabase
    .from('talentone_kunden').select('status').eq('id', kundeId).maybeSingle();
  if (kunde?.status === 'aktiv') {
    out.formular_erhalten = true;
    out.onboarding_formular = true;
  }

  // Fotos / Referenzbilder
  const { count: fotoCount } = await supabase
    .from('talentone_referenzbilder').select('id', { count: 'exact', head: true })
    .eq('kunde_id', kundeId);
  if (fotoCount && fotoCount > 0) out.fotos_erhalten = true;

  // Creatives
  const { count: creativeCount } = await supabase
    .from('talentone_creatives').select('id', { count: 'exact', head: true })
    .in('job_id', jobIds);
  if (creativeCount && creativeCount > 0) out.creatives_erstellt = true;

  // Adcopies
  const { count: adcopyCount } = await supabase
    .from('talentone_adcopies').select('id', { count: 'exact', head: true })
    .in('job_id', jobIds);
  if (adcopyCount && adcopyCount > 0) out.adcopies_geschrieben = true;

  // Funnel veröffentlicht
  const { data: funnels } = await supabase
    .from('talentone_funnels').select('veroeffentlicht, extern, extern_url').in('job_id', jobIds);
  if (funnels?.some(f => f.veroeffentlicht || (f.extern && f.extern_url))) {
    out.bewerberliste_erstellt = true;
    out.url_connected = true;
  }

  // Entwürfe-Mail an Kunde
  const { count: versandCount } = await supabase
    .from('talentone_versand').select('id', { count: 'exact', head: true }).in('job_id', jobIds);
  if (versandCount && versandCount > 0) out.entwuerfe_verschickt = true;

  // Review freigegeben
  const { data: reviews } = await supabase
    .from('talentone_reviews').select('status').in('job_id', jobIds);
  if (reviews?.some(r => r.status === 'freigegeben')) out.go_vom_kunden = true;

  return out;
}

/**
 * Mergt manuelle Checkliste + Auto-Flags. Auto-Flags überschreiben manuelle
 * `false`-Werte, lassen `true` aber unberührt. Liefert ein Tupel
 * { checkliste, auto: ['key1','key2'] } — auto enthält die per Auto gesetzten Keys.
 */
export function mergeChecklist(manual = {}, auto = {}) {
  const merged = { ...(manual || {}) };
  const autoKeys = [];
  for (const k of SYNC_KEYS) {
    if (auto[k]) {
      merged[k] = true;
      autoKeys.push(k);
    }
  }
  return { checkliste: merged, auto_set: autoKeys };
}

export { SYNC_KEYS };
