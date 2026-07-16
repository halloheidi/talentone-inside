
-- Job: Vorqualifizierungs-Felder-Schema (Array von {name, typ, optionen?})
ALTER TABLE talentone_jobs
  ADD COLUMN IF NOT EXISTS vorqualifizierung_felder jsonb DEFAULT '[]'::jsonb;

-- Notizen: Erledigt-Haken + Kontaktiert-Daten + VG + Eingestellt + Werte für Vorqual-Felder
ALTER TABLE talentone_bewerber_notizen
  ADD COLUMN IF NOT EXISTS erledigt boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS nw_kontaktiert text,
  ADD COLUMN IF NOT EXISTS kunde_kontaktiert text,
  ADD COLUMN IF NOT EXISTS vg_vereinbart_am timestamptz,
  ADD COLUMN IF NOT EXISTS eingestellt text DEFAULT 'offen' CHECK (eingestellt IN ('ja','nein','offen')),
  ADD COLUMN IF NOT EXISTS vorqualifizierung_werte jsonb DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS notizen_erledigt_idx
  ON talentone_bewerber_notizen (erledigt);
