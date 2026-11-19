-- Anonyme Stelle: neutrale Identität je Stelle, überschreibt die echte Kundenidentität
-- überall dort, wo Kandidaten-/Kundensichtbares gerendert wird (Funnel, Creatives, Ad-Copies,
-- Prüfungsseite). NULL = echte Kundenidentität (Normalfall). Einzelne anonyme Stellen eines
-- Kunden bleiben unabhängig (andere Stellen desselben Kunden sind unverändert).
alter table talentone_jobs
  add column if not exists anonym jsonb;

comment on column talentone_jobs.anonym is
  'Neutrale Identität der anonymen Stelle. NULL/aktiv=false => echte Kundenidentität. '
  '{aktiv:bool, name:text, logo_url:text, logo_transparent_url:text, '
  'farben:{primaer,sekundaer,akzent}, ort_anzeige:text, facebook_seite:text, '
  'absender_name:text, branche:text, perspective_brand_id:text}. '
  'perspective_brand_id = eigene neutrale Perspective-Brand (NICHT talentone_kunden.perspective_brand_id).';
