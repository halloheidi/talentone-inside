
-- Notizen (interne Mitarbeiter-Sicht)
CREATE TABLE IF NOT EXISTS talentone_bewerber_notizen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bewerbung_id uuid NOT NULL REFERENCES talentone_bewerbungen(id) ON DELETE CASCADE,
  status text DEFAULT 'neu',
  bewertung integer CHECK (bewertung IS NULL OR (bewertung BETWEEN 1 AND 5)),
  gehaltswunsch text,
  verfuegbarkeit text,
  naechste_aktion text,
  notizen text,
  anrufversuche jsonb DEFAULT '[]'::jsonb,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (bewerbung_id)
);
CREATE INDEX IF NOT EXISTS talentone_bewerber_notizen_bewerbung_idx
  ON talentone_bewerber_notizen (bewerbung_id);

-- Kundenfeedback (Public-View, Token-basiert)
CREATE TABLE IF NOT EXISTS talentone_bewerber_kundenfeedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bewerbung_id uuid NOT NULL REFERENCES talentone_bewerbungen(id) ON DELETE CASCADE,
  status text DEFAULT 'neu',
  vorstellungsgespraech_am timestamptz,
  notizen text,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (bewerbung_id)
);
CREATE INDEX IF NOT EXISTS talentone_bewerber_kundenfeedback_bewerbung_idx
  ON talentone_bewerber_kundenfeedback (bewerbung_id);

-- Eigene Spalten pro Job
CREATE TABLE IF NOT EXISTS talentone_bewerber_spalten (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES talentone_jobs(id) ON DELETE CASCADE,
  name text NOT NULL,
  typ text NOT NULL DEFAULT 'text' CHECK (typ IN ('text', 'dropdown', 'datum')),
  optionen jsonb,
  reihenfolge integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS talentone_bewerber_spalten_job_idx
  ON talentone_bewerber_spalten (job_id, reihenfolge);

-- Werte für eigene Spalten (key/value pro Bewerbung)
CREATE TABLE IF NOT EXISTS talentone_bewerber_spalten_werte (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bewerbung_id uuid NOT NULL REFERENCES talentone_bewerbungen(id) ON DELETE CASCADE,
  spalte_id uuid NOT NULL REFERENCES talentone_bewerber_spalten(id) ON DELETE CASCADE,
  wert text,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (bewerbung_id, spalte_id)
);
CREATE INDEX IF NOT EXISTS talentone_bewerber_spalten_werte_bew_idx
  ON talentone_bewerber_spalten_werte (bewerbung_id);

-- Neue Felder in talentone_jobs
ALTER TABLE talentone_jobs
  ADD COLUMN IF NOT EXISTS bewerbungen_token uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS interne_spalten jsonb DEFAULT '["status","bewertung","gehaltswunsch","verfuegbarkeit","anrufversuche","naechste_aktion","notizen"]'::jsonb;

-- Backfill: bestehende Jobs ohne Token bekommen einen
UPDATE talentone_jobs SET bewerbungen_token = gen_random_uuid() WHERE bewerbungen_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS talentone_jobs_bewerbungen_token_idx
  ON talentone_jobs (bewerbungen_token);
