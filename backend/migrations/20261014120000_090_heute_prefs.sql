-- 090 — /heute: pro-Nutzer-Layout (Kachel-Reihenfolge + ausgeblendete Kacheln).
-- Schlichte Personalisierung (keine Widget-Engine): nur order[] + hidden[] als jsonb.
CREATE TABLE IF NOT EXISTS talentone_heute_prefs (
  email      text PRIMARY KEY,
  layout     jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { order: ["kritisch",…], hidden: ["instantly"] }
  updated_at timestamptz NOT NULL DEFAULT now()
);
