-- close_lead_id am Kunden (primäre Quelle laut Punkt 8). Bestehende Feld an
-- talentone_projekte bleibt unberührt und wird beim ersten Verknüpfen synchronisiert.
ALTER TABLE talentone_kunden
  ADD COLUMN IF NOT EXISTS close_lead_id TEXT;

COMMENT ON COLUMN talentone_kunden.close_lead_id IS
  'Primäre Close-CRM-Lead-ID (beginnt mit lead_). Basis für automatische Notes bei allen Tool-Aktivitäten.';

-- Format-Validierung: muss mit lead_ beginnen (oder NULL).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'talentone_kunden_close_lead_id_format'
  ) THEN
    ALTER TABLE talentone_kunden
      ADD CONSTRAINT talentone_kunden_close_lead_id_format
      CHECK (close_lead_id IS NULL OR close_lead_id LIKE 'lead\_%' ESCAPE '\');
  END IF;
END $$;

-- Backfill von projekte.close_lead_id → kunden.close_lead_id, wo Kunde noch leer ist
UPDATE talentone_kunden k
SET close_lead_id = p.close_lead_id
FROM talentone_projekte p
WHERE p.kunde_id = k.id
  AND p.close_lead_id IS NOT NULL
  AND p.close_lead_id LIKE 'lead\_%' ESCAPE '\'
  AND k.close_lead_id IS NULL;

-- arbeitshinweise am Job (dauerhafte Hinweis-Notiz über allen Tabs)
ALTER TABLE talentone_jobs
  ADD COLUMN IF NOT EXISTS arbeitshinweise TEXT;

COMMENT ON COLUMN talentone_jobs.arbeitshinweise IS
  'Freitextnotiz zur Kampagnen-Bearbeitung (z. B. "Keine KI-Bilder gewünscht"). Wird als auffälliger Banner über allen Job-Tabs angezeigt.';
