-- 089 — Heute-Dashboard (/heute): persistente, NUTZER-bezogene Zustände.
--
-- talentone_settings (global key/value) existiert bereits und hält die runtime-
-- editierbaren Keys (close_api_key, instantly_api_key). Hier nur die pro-Nutzer-Daten:

-- (a) „Erledigt heute ausblenden": pro Nutzer (email) + Tag + Listen-Eintrag (item_key).
CREATE TABLE IF NOT EXISTS talentone_heute_erledigt (
  email      text NOT NULL,
  tag        date NOT NULL,
  item_key   text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (email, tag, item_key)
);

-- (b) Mini-To-dos: schlichte persönliche Checkliste je Nutzer.
CREATE TABLE IF NOT EXISTS talentone_heute_todos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  text        text NOT NULL,
  faellig     date,
  erledigt    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  erledigt_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_heute_todos_email ON talentone_heute_todos (email, erledigt, created_at);
