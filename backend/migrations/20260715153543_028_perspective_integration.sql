-- Perspective-Brand pro Kunde
ALTER TABLE talentone_kunden
  ADD COLUMN IF NOT EXISTS perspective_brand_id text,
  ADD COLUMN IF NOT EXISTS website_domain text;
COMMENT ON COLUMN talentone_kunden.perspective_brand_id IS 'Perspective Brand-ID nach erstem create_brand-Call.';
COMMENT ON COLUMN talentone_kunden.website_domain IS 'Kunden-Website (fuer create_brand source=domain).';

-- Perspective-Funnel-Referenzen am Funnel
ALTER TABLE talentone_funnels
  ADD COLUMN IF NOT EXISTS perspective_funnel_id  text,
  ADD COLUMN IF NOT EXISTS perspective_editor_url text,
  ADD COLUMN IF NOT EXISTS perspective_job_id     text,
  ADD COLUMN IF NOT EXISTS perspective_status     text,
  ADD COLUMN IF NOT EXISTS perspective_schema     text,
  ADD COLUMN IF NOT EXISTS perspective_prompt     text,
  ADD COLUMN IF NOT EXISTS perspective_last_error text,
  ADD COLUMN IF NOT EXISTS perspective_meta       jsonb,
  ADD COLUMN IF NOT EXISTS manual_pixel_done      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS manual_webhook_done    boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN talentone_funnels.perspective_status IS
  'creating | polling | completed | error — Status der Perspective-Generierung.';
COMMENT ON COLUMN talentone_funnels.perspective_meta IS
  'Ergaenzende Daten aus der Perspective-Response (published_url, brandId, domain-slug).';
