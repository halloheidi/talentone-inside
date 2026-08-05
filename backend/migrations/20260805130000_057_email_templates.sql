-- Editierbare E-Mail-Vorlagen (Kunden-Mails) mit getrennter Du-/Sie-Fassung,
-- gesteuert über talentone_kunden.anrede_form. Fehlt eine Vorlage, greift der
-- Code-Default (Versand bricht nie ab). Seed folgt in 058.
CREATE TABLE IF NOT EXISTS talentone_email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  agentur text NOT NULL,                 -- 'talentone' | 'nowagwirth'
  name text,
  beschreibung text,                     -- wann/an wen die Mail geht
  betreff_du text,
  betreff_sie text,
  body_du text,                          -- HTML (Intro/Nachricht; dynamische Teile bleiben im Code)
  body_sie text,
  platzhalter jsonb NOT NULL DEFAULT '[]'::jsonb,  -- erlaubte {{variablen}}
  aktiv boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  UNIQUE (key, agentur)
);
CREATE INDEX IF NOT EXISTS talentone_email_templates_key_idx ON talentone_email_templates (key, agentur) WHERE aktiv;
