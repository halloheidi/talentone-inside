-- 095 — Funnel-Event-Tracking für selbst gehostete Neukunden-Landingpages.
-- Keine personenbezogenen Daten: session_id ist eine pro Besuch im Browser erzeugte
-- Zufalls-ID (keine Cookies, keine IP). Dedup pro (job_id, session_id, event) → nur
-- das erste Vorkommen zählt (UNIQUE + upsert ignoreDuplicates beim Insert).
CREATE TABLE IF NOT EXISTS talentone_funnel_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id     uuid NOT NULL REFERENCES talentone_jobs(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  event      text NOT NULL,   -- pageview | schritt_1 … schritt_5
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, session_id, event)
);
CREATE INDEX IF NOT EXISTS idx_funnel_events_job ON talentone_funnel_events (job_id, created_at);
