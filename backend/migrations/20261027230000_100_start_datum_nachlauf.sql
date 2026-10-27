-- 100 — Z1-Nachlauf: start_datum für Projekte mit vertragsmodell, aber ohne start_datum.
-- Vorbelegung aus dem frühesten bekannten Meta-Aktivitätsdatum der zugeordneten Objekte
-- (meta_start_time der Kampagne/Anzeigengruppe bzw. frühester Laufphasen-Start). Nur dort,
-- wo ableitbar; nicht überschreibend. Johannes prüft die Live-Projekte nach.
WITH j AS (
  SELECT id AS job_id, projekt_id FROM talentone_jobs WHERE projekt_id IS NOT NULL
),
kand AS (
  SELECT j.projekt_id AS pid, k.meta_start_time::date AS d
    FROM j JOIN talentone_meta_kampagnen k ON k.job_id = j.job_id AND coalesce(k.gemischt,false) = false
    WHERE k.meta_start_time IS NOT NULL
  UNION ALL
  SELECT j.projekt_id, a.meta_start_time::date
    FROM j JOIN talentone_meta_adsets a ON a.job_id = j.job_id
    WHERE a.meta_start_time IS NOT NULL
  UNION ALL
  SELECT j.projekt_id, lp.phase_start
    FROM j JOIN talentone_meta_kampagnen k ON k.job_id = j.job_id AND coalesce(k.gemischt,false) = false
    JOIN talentone_meta_laufphasen lp ON lp.meta_objekt_id = k.meta_campaign_id
),
best AS (SELECT pid, min(d) AS start_d FROM kand GROUP BY pid)
UPDATE talentone_projekte p
   SET start_datum = best.start_d
  FROM best
 WHERE p.id = best.pid
   AND p.vertragsmodell IS NOT NULL
   AND p.start_datum IS NULL;
