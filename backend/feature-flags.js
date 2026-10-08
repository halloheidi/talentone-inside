// Per-Nutzer-Feature-Flags. Resolution: Nutzer-Override > globaler Override > Code-Default.
// Steuert den parallelen Creative-Wizard-V2-Reiter, ohne den Alt-Pfad zu berühren.

import { supabase } from './supabase.js';
import { isAdminEmail } from './team.js';

export const FEATURE_FLAGS = ['creative_wizard_v2', 'hide_creatives_v1'];

// Code-Default, falls weder Nutzer- noch globaler Override existiert.
function codeDefault(flag, email) {
  if (flag === 'creative_wizard_v2') return isAdminEmail(email); // Testphase: Admins sehen V2
  if (flag === 'hide_creatives_v1') return false;                // Alt-Reiter bleibt zunächst sichtbar
  return false;
}

export async function resolveFlags(email) {
  let rows = [];
  try {
    const { data } = await supabase.from('talentone_feature_flags').select('flag, email, enabled').in('flag', FEATURE_FLAGS);
    rows = data || [];
  } catch { rows = []; }
  const out = {};
  for (const flag of FEATURE_FLAGS) {
    const userRow = rows.find(r => r.flag === flag && r.email === email);
    const globalRow = rows.find(r => r.flag === flag && !r.email);
    out[flag] = userRow ? !!userRow.enabled : (globalRow ? !!globalRow.enabled : codeDefault(flag, email));
  }
  return out;
}

export async function listFlags() {
  const { data } = await supabase.from('talentone_feature_flags').select('*').order('flag');
  return data || [];
}

// Setzt/aktualisiert einen Flag (email null = globaler Default). Ohne Upsert, da der
// Unique-Index auf coalesce(email,'') kein direktes onConflict-Ziel ist.
export async function setFlag({ flag, email = null, enabled, updatedBy = null }) {
  if (!FEATURE_FLAGS.includes(flag)) throw new Error(`Unbekannter Flag: ${flag}`);
  const base = supabase.from('talentone_feature_flags').select('id').eq('flag', flag);
  const { data: existing } = email ? await base.eq('email', email).maybeSingle() : await base.is('email', null).maybeSingle();
  const payload = { flag, email: email || null, enabled: !!enabled, updated_at: new Date().toISOString(), updated_by: updatedBy };
  if (existing) { const { error } = await supabase.from('talentone_feature_flags').update(payload).eq('id', existing.id); if (error) throw new Error(error.message); }
  else { const { error } = await supabase.from('talentone_feature_flags').insert(payload); if (error) throw new Error(error.message); }
}
