-- 096 — A1: Meta-Zuordnung je Ebene (Kampagne ODER Anzeigengruppe je Job).
-- REIN ADDITIV. Bestehende Adset-Infra (talentone_meta_adsets, _adset_insights) wird
-- als "Anzeigengruppen" wiederverwendet — keine neue Tabelle. Ingest/Mails/Routing/
-- Controlling bleiben unberührt; alte Attribution (meta_kampagnen.job_id, meta_adsets.job_id)
-- bleibt bestehen und wird NICHT entfernt.

-- (1) Fehlende Spalten ergänzen (Deltas gegenüber Bizjak-Adset-Arbeit)
ALTER TABLE talentone_meta_adsets          ADD COLUMN IF NOT EXISTS daily_budget numeric;
ALTER TABLE talentone_meta_adset_insights  ADD COLUMN IF NOT EXISTS results      integer;

-- (2) jobs.meta_zuordnung: EINE explizite Quelle der Wahrheit je Job.
--     Form: {"ebene":"kampagne"|"anzeigengruppe", "id":"<meta objekt id>"}
ALTER TABLE talentone_jobs ADD COLUMN IF NOT EXISTS meta_zuordnung jsonb;

-- (3) Laufphasen generalisieren: Schlüssel = meta_objekt_id + ebene
--     (bisher nur Kampagnen-Ebene). Default 'kampagne', Bestand backfillen.
ALTER TABLE talentone_meta_laufphasen ADD COLUMN IF NOT EXISTS meta_objekt_id text;
ALTER TABLE talentone_meta_laufphasen ADD COLUMN IF NOT EXISTS ebene text NOT NULL DEFAULT 'kampagne';
UPDATE talentone_meta_laufphasen
   SET meta_objekt_id = meta_campaign_id
 WHERE meta_objekt_id IS NULL;

-- (4) Backfill jobs.meta_zuordnung — NUR eindeutige Fälle.
--     (a) Jobs mit GENAU EINER nicht-gemischten Kampagne (7 Jobs) -> {ebene:'kampagne'}
WITH einzel AS (
  SELECT job_id, min(meta_campaign_id) AS cid
  FROM talentone_meta_kampagnen
  WHERE job_id IS NOT NULL AND coalesce(gemischt,false) = false
  GROUP BY job_id
  HAVING count(*) = 1
)
UPDATE talentone_jobs j
   SET meta_zuordnung = jsonb_build_object('ebene','kampagne','id', e.cid)
  FROM einzel e
 WHERE j.id = e.job_id AND j.meta_zuordnung IS NULL;

--     (b) Jobs mit zugeordneter Anzeigengruppe (aktuell 0) -> {ebene:'anzeigengruppe'}
UPDATE talentone_jobs j
   SET meta_zuordnung = jsonb_build_object('ebene','anzeigengruppe','id', a.meta_adset_id)
  FROM talentone_meta_adsets a
 WHERE j.id = a.job_id AND a.job_id IS NOT NULL AND j.meta_zuordnung IS NULL;

-- HINWEIS: 13 Jobs haben MEHRERE nicht-gemischte Kampagnen (historisch, mehrere
-- Kampagnen je Stelle über die Zeit). Ein einzelnes {ebene,id} kann das nicht
-- eindeutig abbilden, daher bleibt meta_zuordnung dort NULL. Diese Jobs werden
-- weiterhin über die bestehende Reverse-FK (meta_kampagnen.job_id) bedient; der
-- Helper aktiveLauftage() und der Live-Wächter nutzen einen Reverse-FK-Fallback,
-- sodass kein Verhalten verloren geht. Explizite Zuordnung über die /admin/meta-UI
-- überschreibt den Fallback jederzeit.

-- Index für den Reverse-FK-Fallback-Lookup je Objekt/Ebene
CREATE INDEX IF NOT EXISTS idx_meta_laufphasen_objekt
  ON talentone_meta_laufphasen (meta_objekt_id, ebene);
