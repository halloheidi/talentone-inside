-- Alte Status-Whitelist entfernen — Pipeline ist jetzt konfigurierbar
ALTER TABLE talentone_anfragen
  DROP CONSTRAINT IF EXISTS talentone_anfragen_status_check;

COMMENT ON COLUMN talentone_anfragen.status IS
  'Freie String-ID einer Pipeline-Stufe aus talentone_jobs.pipeline_stufen. Default "neu".';
