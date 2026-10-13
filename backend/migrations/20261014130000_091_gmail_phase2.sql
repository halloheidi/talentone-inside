-- 091 — Phase 2: Gmail-OAuth-Konten + Mail-Log für das Heute-Dashboard.

-- Verbundene Gmail-Konten (Mehrkonten). Tokens serverseitig (service-role, wie andere
-- Secrets). scope dokumentiert, womit das Konto autorisiert wurde (readonly/send/compose).
CREATE TABLE IF NOT EXISTS talentone_gmail_konten (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,            -- die Gmail-Adresse
  display_name  text,
  access_token  text,
  refresh_token text,
  token_expiry  timestamptz,
  scope         text,
  status        text NOT NULL DEFAULT 'aktiv',   -- aktiv | fehler
  connected_by  text,                            -- interner Admin, der verbunden hat
  connected_at  timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Protokoll jedes Versands/Drafts aus dem Tagesdashboard (NIE automatischer Versand).
CREATE TABLE IF NOT EXISTS talentone_mail_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  konto_email  text,
  empfaenger   text,
  thread_id    text,
  message_id   text,            -- gesendete/Draft-Message-ID (Gmail)
  betreff      text,
  typ          text NOT NULL,   -- 'antwort' | 'draft'
  quelle       text NOT NULL DEFAULT 'tagesdashboard',
  kontext      jsonb,           -- angeheftetes CRM-Kontext-Snapshot (kunde/bewerber)
  gesendet_von text,            -- interner Admin
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mail_log_created ON talentone_mail_log (created_at DESC);
