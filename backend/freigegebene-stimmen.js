// A5: Zentrale Quelle für VERWENDBARE Mitarbeiterstimmen.
//
// Einzige Stelle, über die Funnel-Builder und Creative-Wizard Mitarbeiterstimmen
// beziehen — und zwar AUSSCHLIESSLICH freigegebene (freigabe=true). Damit kann eine
// nicht freigegebene Stimme nie in einem Funnel-/Creative-Vorschlag auftauchen.

import { supabase } from './supabase.js';

export async function freigegebeneStimmen(kundeId) {
  if (!kundeId) return [];
  const { data } = await supabase.from('talentone_mitarbeiterstimmen')
    .select('id, name, rolle, dabei_seit, zitat, foto_url, reihenfolge')
    .eq('kunde_id', kundeId).eq('freigabe', true)
    .order('reihenfolge', { ascending: true }).order('created_at', { ascending: true });
  return data || [];
}

// Kompakte Textform für AI-Prompts (nur freigegebene).
export async function freigegebeneStimmenText(kundeId) {
  const stimmen = await freigegebeneStimmen(kundeId);
  return stimmen
    .filter(s => (s.zitat || '').trim())
    .map(s => `„${s.zitat.trim()}"${s.name ? ` — ${s.name}` : ''}${s.rolle ? `, ${s.rolle}` : ''}${s.dabei_seit ? ` (seit ${s.dabei_seit})` : ''}`)
    .join('\n');
}
