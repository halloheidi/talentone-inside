ALTER TABLE talentone_bewerber_spalten
  ADD COLUMN IF NOT EXISTS sichtbar_fuer text DEFAULT 'intern' CHECK (sichtbar_fuer IN ('intern','kunde'));

CREATE INDEX IF NOT EXISTS bewerber_spalten_sichtbar_idx
  ON talentone_bewerber_spalten (job_id, sichtbar_fuer);
