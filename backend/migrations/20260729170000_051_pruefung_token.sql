-- Daten-Prüfung durch den Kunden: job-eigener Public-Token (wie review_token),
-- über den der Kunde die bereits erfassten Stellendaten prüft/ergänzt.
ALTER TABLE talentone_jobs ADD COLUMN IF NOT EXISTS pruefung_token text;
CREATE UNIQUE INDEX IF NOT EXISTS talentone_jobs_pruefung_token_uniq
  ON talentone_jobs (pruefung_token) WHERE pruefung_token IS NOT NULL;

-- Warn-Marker: Daten wurden nach der Creative-Erstellung geändert (relevante Felder
-- Benefits/Stelle/Region) → Creatives ggf. veraltet. null = kein offener Hinweis.
ALTER TABLE talentone_jobs ADD COLUMN IF NOT EXISTS daten_geaendert_nach_creatives_at timestamptz;
