ALTER TABLE talentone_kunden
  ADD COLUMN IF NOT EXISTS archiviert BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS archiviert_am TIMESTAMPTZ;

COMMENT ON COLUMN talentone_kunden.archiviert IS
  'Soft-Archiv-Flag. Archivierte Kunden werden aus der Standardliste ausgeblendet, alle Daten bleiben.';

COMMENT ON COLUMN talentone_kunden.archiviert_am IS
  'Zeitpunkt der Archivierung. NULL solange archiviert=false.';

CREATE INDEX IF NOT EXISTS talentone_kunden_archiviert_idx
  ON talentone_kunden(archiviert) WHERE archiviert = FALSE;
