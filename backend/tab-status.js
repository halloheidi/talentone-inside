// Tab-Häkchen (Erledigt-Status pro Job-Tab). Auto-Erkennung + manuelle Overrides.
// Manuell (talentone_jobs.tab_status jsonb) schlägt Auto. Wird im Funnel-/Job-Header
// als ✓ am Reiter angezeigt und von naechste-schritte.js beim Skip berücksichtigt.

export const TAB_KEYS = ['stelle', 'creatives', 'adcopies', 'funnel', 'export'];

/**
 * Auto-Erkennung pro Tab.
 *  - stelle:    Kernfelder befüllt (Stelle + Region + mind. ein Inhaltsfeld)
 *  - creatives: mind. 1 aktives (nicht archiviertes) Creative
 *  - adcopies:  mind. 1 Ad Copy
 *  - funnel:    veröffentlicht ODER externe URL gesetzt
 *  - export:    Entwürfe verschickt (Versand typ entwurf_runde_*)
 */
export function computeAutoTabStatus({ job, creativesActiveCount, adcopiesCount, funnels, hatEntwurfsversand }) {
  const hatBenefits = Array.isArray(job?.benefits) ? job.benefits.length > 0 : !!job?.benefits;
  const stelleDone = !!(job?.stelle && job?.region && (hatBenefits || job?.gehalt || job?.besonderheiten));
  const funnelDone = (funnels || []).some(f => f.veroeffentlicht || (f.extern && f.extern_url));
  return {
    stelle: stelleDone,
    creatives: (creativesActiveCount || 0) >= 1,
    adcopies: (adcopiesCount || 0) >= 1,
    funnel: funnelDone,
    export: !!hatEntwurfsversand,
  };
}

/** Effektiver Status: manueller Boolean schlägt Auto, sonst Auto. */
export function effectiveTabStatus(auto, manual) {
  const m = manual && typeof manual === 'object' ? manual : {};
  const out = {};
  for (const k of TAB_KEYS) {
    out[k] = typeof m[k] === 'boolean' ? m[k] : !!auto?.[k];
  }
  return out;
}
