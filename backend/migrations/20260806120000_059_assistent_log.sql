-- Protokoll der Tool-Aufrufe des internen KI-Assistenten (Phase 1).
-- Hält fest, wer wann welche Funktion mit welchen Parametern ausgelöst hat.
CREATE TABLE IF NOT EXISTS talentone_assistent_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_email text,
  tool_name text NOT NULL,
  parameter jsonb NOT NULL DEFAULT '{}'::jsonb,
  ergebnis text          -- 'ok' | 'fehler' | 'abgelehnt' (grobe Ausführungs-Notiz)
);
CREATE INDEX IF NOT EXISTS talentone_assistent_log_created_idx ON talentone_assistent_log (created_at DESC);
