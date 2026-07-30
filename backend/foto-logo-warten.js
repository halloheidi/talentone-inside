// Gemeinsame Quelle für den "Warten auf Fotos/Logo"-Zustand.
// Nutzen: der Badge im Projekt-Kopf, der Chip in der Kunden-Detailansicht UND
// die "Nächster Schritt"-Logik (naechste-schritte.js) — damit alle drei nie
// auseinanderlaufen.
//
// Datenquelle: Versand-Log (typ='anfrage', inhalte.umfang) + Logo (kunde.logo_url)
// + Fotos (talentone_referenzbilder, typ != 'logo').

import { supabase } from './supabase.js';

// Reine Berechnung aus den Rohdaten. Gibt null zurück, wenn nichts offen ist.
export function computeFotoLogoWarten({ anfrageVersand, uploadToken, hatLogo, hatFotos }) {
  const angefragt = !!anfrageVersand || !!uploadToken;
  if (!angefragt) return null;
  const umfang = anfrageVersand?.inhalte?.umfang || 'beides';
  const wantLogo = umfang !== 'fotos';
  const wantFotos = umfang !== 'logo';
  const fehltLogo = wantLogo && !hatLogo;
  const fehltFotos = wantFotos && !hatFotos;
  if (!fehltLogo && !fehltFotos) return null; // alles Angefragte ist da
  const angefragt_am = anfrageVersand?.created_at || null;
  const tage = angefragt_am ? Math.floor((Date.now() - new Date(angefragt_am).getTime()) / 86400000) : null;
  return {
    fehlt_fotos: fehltFotos,
    fehlt_logo: fehltLogo,
    umfang,
    angefragt_am,
    tage,
    ueberfaellig: tage != null && tage >= 7,
  };
}

// Menschlich lesbares Label: "Warten auf Fotos", "Warten auf Logo" oder "… Fotos & Logo".
export function fotoLogoWartenLabel(w) {
  if (!w) return null;
  const teile = [w.fehlt_fotos && 'Fotos', w.fehlt_logo && 'Logo'].filter(Boolean);
  return `Warten auf ${teile.join(' & ')}`;
}

// Lädt die nötigen Daten für einen Job (kunde-weit, da Logo/Fotos Kunden-Assets sind)
// und berechnet den Warte-Zustand.
export async function getFotoLogoWartenForJob(jobId) {
  const { data: job } = await supabase.from('talentone_jobs')
    .select('id, kunde_id').eq('id', jobId).maybeSingle();
  if (!job) return null;
  const { data: kunde } = await supabase.from('talentone_kunden')
    .select('id, logo_url, upload_token').eq('id', job.kunde_id).maybeSingle();
  if (!kunde) return null;

  // Sind für DIESEN Job schon Creatives da, haben wir ohne Kundenfotos gearbeitet —
  // dann kein Warte-Badge mehr (deckungsgleich mit dem "Nächster Schritt"-Skip).
  const { count: creativesCount } = await supabase.from('talentone_creatives')
    .select('id', { count: 'exact', head: true }).eq('job_id', jobId).neq('archiviert', true);
  if ((creativesCount || 0) > 0) return null;

  const { data: kundeJobs } = await supabase.from('talentone_jobs')
    .select('id').eq('kunde_id', kunde.id);
  const jobIds = (kundeJobs || []).map(j => j.id);

  const [anfrageRes, refbilderRes] = await Promise.all([
    jobIds.length
      ? supabase.from('talentone_versand')
          .select('created_at, inhalte').in('job_id', jobIds).eq('typ', 'anfrage')
          .order('created_at', { ascending: false }).limit(1).maybeSingle()
      : { data: null },
    supabase.from('talentone_referenzbilder').select('typ').eq('kunde_id', kunde.id),
  ]);

  const hatFotos = (refbilderRes.data || []).some(r => r.typ !== 'logo');
  return computeFotoLogoWarten({
    anfrageVersand: anfrageRes.data || null,
    uploadToken: kunde.upload_token,
    hatLogo: !!kunde.logo_url,
    hatFotos,
  });
}
