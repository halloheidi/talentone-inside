-- KI-verbesserte Fotos werden mit uploaded_via='ai_enhance' eingefügt
-- (backend/photo-enhance.js → saveVerbesserung). Der bestehende Check-Constraint
-- erlaubte nur 'mitarbeiter' | 'kunde' → Insert schlug fehl. Wert ergänzen.
alter table talentone_referenzbilder
  drop constraint if exists talentone_referenzbilder_uploaded_via_check;

alter table talentone_referenzbilder
  add constraint talentone_referenzbilder_uploaded_via_check
  check (uploaded_via = any (array['mitarbeiter'::text, 'kunde'::text, 'ai_enhance'::text]));
