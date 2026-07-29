-- Diskriminator für getrennte Review-Ströme: 'entwurf' (Entwurfs-Runden) vs
-- 'update' (Kampagnen-Update-Runden während der Live-Phase). Der Aktivitäts-
-- Service und die getrennte Runden-Zählung ("Runde N" vs "Update N") bauen darauf.
-- Der Wechsel des Unique-Index auf (job_id, kontext, runde) folgt mit dem
-- Kampagnen-Update-Feature (049), sobald tatsächlich Update-Runden entstehen.
ALTER TABLE talentone_reviews ADD COLUMN IF NOT EXISTS kontext text NOT NULL DEFAULT 'entwurf';
