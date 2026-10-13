-- 092 — Lernende Feinsteuerung der „Wichtige Mails"-Kachel pro Nutzer:
-- block (nie anzeigen) / allow (immer anzeigen, schlägt die Verteiler-Automatik).
-- muster = volle Absender-Adresse ODER Domain (ohne @).
CREATE TABLE IF NOT EXISTS talentone_gmail_absender_regeln (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nutzer     text NOT NULL,                 -- interner Admin (email)
  muster     text NOT NULL,                 -- 'absender@x.de' oder 'x.de'
  regel      text NOT NULL CHECK (regel IN ('block', 'allow')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (nutzer, muster)
);
CREATE INDEX IF NOT EXISTS idx_gmail_regeln_nutzer ON talentone_gmail_absender_regeln (nutzer);
