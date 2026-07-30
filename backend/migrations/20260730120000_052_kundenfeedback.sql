-- Wöchentliches Zufriedenheits-Feedback (nur TalentOne, Live-Projekte).
-- Kunde-Einstellungen + Rhythmus-Tracking:
--   feedback_mails            an/aus (Default an) — abschaltbar pro Kunde
--   feedback_token            Public-Link zum Feedback-Formular (lazy)
--   feedback_mail_zuletzt_am  letzte Feedback-Mail (für 1×/Woche-Grenze)
--   feedback_unbeantwortet    aufeinanderfolgende unbeantwortete Mails; ≥2 → 14-tägig
ALTER TABLE talentone_kunden ADD COLUMN IF NOT EXISTS feedback_mails boolean NOT NULL DEFAULT true;
ALTER TABLE talentone_kunden ADD COLUMN IF NOT EXISTS feedback_token text;
CREATE UNIQUE INDEX IF NOT EXISTS talentone_kunden_feedback_token_uniq
  ON talentone_kunden (feedback_token) WHERE feedback_token IS NOT NULL;
ALTER TABLE talentone_kunden ADD COLUMN IF NOT EXISTS feedback_mail_zuletzt_am timestamptz;
ALTER TABLE talentone_kunden ADD COLUMN IF NOT EXISTS feedback_unbeantwortet int NOT NULL DEFAULT 0;

-- Antworten: sterne (1-5), antworten jsonb (qualitaet, einstellung), freitext.
CREATE TABLE IF NOT EXISTS talentone_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  kunde_id uuid REFERENCES talentone_kunden(id) ON DELETE CASCADE,
  projekt_id uuid,
  woche text,
  sterne int,
  antworten jsonb,
  freitext text
);
CREATE INDEX IF NOT EXISTS talentone_feedback_kunde_idx ON talentone_feedback (kunde_id, created_at DESC);
