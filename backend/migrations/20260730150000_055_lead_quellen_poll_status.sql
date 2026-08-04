-- Poll-Status pro Lead-Quelle persistieren, damit Fehler nie wieder leise
-- verschluckt werden (im UI sichtbar).
ALTER TABLE talentone_lead_quellen ADD COLUMN IF NOT EXISTS letzter_fehler text;
ALTER TABLE talentone_lead_quellen ADD COLUMN IF NOT EXISTS letzter_poll_at timestamptz;
