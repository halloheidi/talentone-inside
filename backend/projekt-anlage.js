// Zentrale Anlage-Logik: Kunde + Job + Projekt (Kanban-Zeile) in einem Rutsch.
// Extrahiert aus dem /api/kunden/quick-create-Handler, damit die Route UND der
// KI-Assistent (routes/assistent.js) denselben Pfad nutzen — keine Duplikation.
//
// Erwartet fertig aufgebaute kundeData/jobData (wie die Route sie je nach Modus
// baut) + meta mit den Projekt-Flags. Legt bei Job-Fehler den Kunden wieder an-
// gelegt zurück (kein Halb-Zustand). Gibt { kunde, job } zurück; wirft bei Fehler.

import { supabase } from './supabase.js';

export const PROJEKTE_STATI = [
  'vorbereitung', 'kickoff_vereinbart', 'onboarding', 'golive_vereinbart',
  'warte_auf_go', 'feedbackschleife', 'go',
  'live', 'pausiert', 'hold', 'abgeschlossen',
];

export async function anlageKundeProjektJob({ kundeData, jobData, meta = {} }) {
  const { data: kunde, error: kErr } = await supabase
    .from('talentone_kunden')
    .insert(kundeData)
    .select()
    .single();
  if (kErr) throw new Error(`Kunde anlegen: ${kErr.message}`);

  const finalAgentur = kunde.agentur === 'nowagwirth' ? 'nowagwirth' : 'talentone';

  const { data: job, error: jErr } = await supabase
    .from('talentone_jobs')
    .insert({
      ...jobData,
      kunde_id: kunde.id,
      vorqualifizierung: kunde.agentur === 'nowagwirth',
    })
    .select()
    .single();
  if (jErr) {
    // Kunde wieder löschen, damit kein Halb-Zustand bleibt
    await supabase.from('talentone_kunden').delete().eq('id', kunde.id);
    throw new Error(`Job anlegen: ${jErr.message}`);
  }

  // Projekt in Kanban anlegen (Kanban/Liste-Übersicht)
  const status = PROJEKTE_STATI.includes(meta.status) ? meta.status : 'vorbereitung';
  const projektName = job.stelle || kunde.firmenname || 'Neues Projekt';
  await supabase.from('talentone_projekte').insert({
    projekt: projektName,
    kunde: kunde.firmenname,
    kunde_id: kunde.id,
    status,
    projektart: meta.projektart || (finalAgentur === 'talentone' ? 'TalentOne - Mitarbeitergewinnung' : 'Mitarbeitergewinnung'),
    projektdauer: meta.projektdauer || null,
    agentur: finalAgentur,
    fotograf_noetig: finalAgentur === 'nowagwirth' ? !!meta.fotograf_noetig : false,
    zahlung_aufgeteilt: !!meta.zahlung_aufgeteilt,
    garantie: !!meta.garantie,
    garantie_details: meta.garantie && meta.garantie_details ? String(meta.garantie_details).trim() : null,
    kickoff_termin: meta.kickoff_termin || null,
    gesuchte_positionen: job.stelle || null,
    standorte: job.region || null,
    verantwortlich: meta.verantwortlich || null,
    email: kunde.email || null,
    close_lead_id: kunde.close_lead_id || null,
    updated_at: new Date().toISOString(),
  });

  return { kunde, job };
}
