-- 099 — A5: Mitarbeiterstimmen (Testimonials) je Kunde. REIN ADDITIV.
-- Nur Stimmen mit freigabe=true dürfen in Funnel/Creatives verwendet werden.
CREATE TABLE IF NOT EXISTS talentone_mitarbeiterstimmen (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kunde_id    uuid NOT NULL REFERENCES talentone_kunden(id) ON DELETE CASCADE,
  name        text,
  rolle       text,
  dabei_seit  text,
  zitat       text,
  foto_url    text,
  freigabe    boolean NOT NULL DEFAULT false,
  quelle      text CHECK (quelle IN ('kunde','pdf','nw')),
  reihenfolge integer DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mitarbeiterstimmen_kunde ON talentone_mitarbeiterstimmen (kunde_id, reihenfolge);
