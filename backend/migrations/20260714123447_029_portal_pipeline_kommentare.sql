-- Portal-Token am Kunden (uuid, auto-generiert beim ersten Zugriff)
ALTER TABLE talentone_kunden
  ADD COLUMN IF NOT EXISTS portal_token UUID DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS talentone_kunden_portal_token_uidx
  ON talentone_kunden(portal_token) WHERE portal_token IS NOT NULL;

COMMENT ON COLUMN talentone_kunden.portal_token IS
  'Persoenlicher Token fuer /portal/:token — das gebuendelte Kunden-Dashboard.';

-- Pipeline-Stufen pro Job (fuer Neukundengewinnung).
-- Array [{id, name, farbe, reihenfolge}]. NULL = Default-Pipeline greift.
ALTER TABLE talentone_jobs
  ADD COLUMN IF NOT EXISTS pipeline_stufen JSONB;

COMMENT ON COLUMN talentone_jobs.pipeline_stufen IS
  'Konfigurierbare Pipeline-Stufen fuer Neukundengewinnung. Array von {id, name, farbe, reihenfolge}. NULL = Default (neu/aktiv/angebot/gewonnen/verloren).';

-- Kommentare pro Anfrage (Lead) — Portal + intern + Airtable-Import
CREATE TABLE IF NOT EXISTS talentone_anfragen_kommentare (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anfrage_id   UUID NOT NULL REFERENCES talentone_anfragen(id) ON DELETE CASCADE,
  autor        TEXT NOT NULL DEFAULT 'Kunde',
  text         TEXT NOT NULL,
  quelle       TEXT NOT NULL DEFAULT 'portal',  -- portal | intern | airtable_import
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS talentone_anfragen_kommentare_anfrage_idx
  ON talentone_anfragen_kommentare(anfrage_id, created_at);

ALTER TABLE talentone_anfragen_kommentare ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'talentone_anfragen_kommentare' AND policyname = 'service_role_all') THEN
    CREATE POLICY service_role_all ON talentone_anfragen_kommentare FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- Bestehende Kunden bekommen sofort einen portal_token
UPDATE talentone_kunden SET portal_token = gen_random_uuid()
WHERE portal_token IS NULL;
