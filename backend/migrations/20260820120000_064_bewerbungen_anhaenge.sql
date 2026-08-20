-- 064: Datei-Anhänge (Lebenslauf o. Ä.) an Bewerbungen.
-- Onepage-/Funnel-Uploads werden beim Ingest erkannt und in einen privaten
-- Bucket (talentone-bewerber-anhaenge) gespiegelt. Auslieferung an die UI via
-- Signed URLs, nie public (Bewerberdaten).
alter table talentone_bewerbungen
  add column if not exists anhaenge jsonb not null default '[]'::jsonb;

comment on column talentone_bewerbungen.anhaenge is
  'Datei-Anhänge: [{label, dateiname, url_original, storage_path}]. storage_path zeigt in den privaten Bucket talentone-bewerber-anhaenge ({bewerbung_id}/{dateiname}); url_original ist der externe Fallback. Auslieferung an UI/Portal via Signed URLs.';
