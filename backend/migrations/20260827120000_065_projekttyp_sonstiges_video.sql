-- 065: Projekttyp 'sonstiges'/'video' (Nicht-Recruiting-Projekte).
-- Nicht-Recruiting-Projekte (z. B. Video-Produktionen) dürfen die Job-Zählung im
-- Multi-Stellen-Match (resolveKundeJob) nicht verfälschen — sie bekommen einen
-- eigenen projekttyp und werden dort ausgeschlossen. Der CHECK-Constraint erlaubt
-- die neuen Werte; der Schüßler-Pseudo-Job "Video" wird migriert.
alter table talentone_jobs drop constraint if exists talentone_jobs_projekttyp_check;
alter table talentone_jobs add constraint talentone_jobs_projekttyp_check
  check (projekttyp = any (array['mitarbeitergewinnung'::text, 'neukundengewinnung'::text, 'sonstiges'::text, 'video'::text]));

update talentone_jobs set projekttyp = 'sonstiges'
  where id = 'f4dce72c-7704-402c-8381-dbe9fdc8851b' and lower(stelle) = 'video';
