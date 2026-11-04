import { supabase } from './supabase.js';

// Standard-Vorqualifizierungsfelder (global, für jede Stelle). Werte liegen in
// talentone_bewerber_notizen.vorqualifizierung_werte unter std_<id> — ausser
// notiz_feld-Feldern (gehaltswunsch, verfuegbarkeit), die bestehende Spalten
// spiegeln. std_key ist der Schlüssel im vorqualifizierung_werte-Objekt (null,
// wenn das Feld eine bestehende Notiz-Spalte spiegelt).
export function mapStandardfeld(f) {
  return {
    id: f.id,
    name: f.name,
    typ: f.typ,
    optionen: Array.isArray(f.optionen) ? f.optionen : null,
    notiz_feld: f.notiz_feld || null,
    validierung: f.validierung || null,
    sichtbar_fuer: f.sichtbar_fuer,
    reihenfolge: f.reihenfolge ?? 0,
    std_key: f.notiz_feld ? null : `std_${f.id}`,
  };
}

// Aktive Standardfelder (sortiert). nurKunde=true → nur sichtbar_fuer='kunde'
// (für das Portal). Fehlertolerant: Tabelle fehlt/leer → [].
export async function ladeStandardfelder({ nurKunde = false } = {}) {
  try {
    let q = supabase.from('talentone_vorqual_standardfelder')
      .select('*').eq('aktiv', true).order('reihenfolge', { ascending: true });
    if (nurKunde) q = q.eq('sichtbar_fuer', 'kunde');
    const { data = [] } = await q;
    return (data || []).map(mapStandardfeld);
  } catch {
    return [];
  }
}
