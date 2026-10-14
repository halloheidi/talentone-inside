-- 093 — „Diese Mail ausblenden" pro Nutzer + Gmail-message_id (dauerhaft, ohne
-- Absender-Block und ohne Eingriff in Gmail). Nachrückende Mails füllen den Platz.
CREATE TABLE IF NOT EXISTS talentone_gmail_ausgeblendet (
  nutzer     text NOT NULL,
  message_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (nutzer, message_id)
);
