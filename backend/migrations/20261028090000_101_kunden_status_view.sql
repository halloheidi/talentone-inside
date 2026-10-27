-- 101 — B1: View für die Kunden-Kanban-Übersicht. REIN ADDITIV (nur Lesen).
-- status_gruppe: Vorbereitung (Default inkl. kickoff/golive_vereinbart), Live, Pausiert
-- (feedbackschleife/hold/pausiert), Abgeschlossen. Alt-Projekte (kunde_id IS NULL) raus.
-- aktivstes Projekt bestimmt die Kunden-Gruppe: live > vorbereitung > pausiert > abgeschlossen.
-- laufzeit_kurz wird NICHT hier berechnet (kommt serverseitig aus laufzeitStatus).
CREATE OR REPLACE VIEW talentone_kunden_status_v AS
WITH p AS (
  SELECT kunde_id, id, projekt, status, created_at,
    CASE
      WHEN status = 'live' THEN 'live'
      WHEN status IN ('feedbackschleife','hold','pausiert') THEN 'pausiert'
      WHEN status = 'abgeschlossen' THEN 'abgeschlossen'
      ELSE 'vorbereitung'
    END AS status_gruppe
  FROM talentone_projekte
  WHERE kunde_id IS NOT NULL
)
SELECT
  kunde_id,
  (ARRAY_AGG(status_gruppe ORDER BY CASE status_gruppe
      WHEN 'live' THEN 0 WHEN 'vorbereitung' THEN 1 WHEN 'pausiert' THEN 2 ELSE 3 END))[1] AS status_gruppe,
  jsonb_agg(jsonb_build_object(
    'id', id, 'projekt', projekt, 'status', status, 'status_gruppe', status_gruppe
  ) ORDER BY created_at DESC) AS projekte_json
FROM p
GROUP BY kunde_id;
