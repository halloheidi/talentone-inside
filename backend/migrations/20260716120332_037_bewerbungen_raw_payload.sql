-- Roh-Payload des Webhooks komplett mitspeichern (nichts geht verloren).
alter table talentone_bewerbungen
  add column if not exists raw jsonb;
comment on column talentone_bewerbungen.raw is
  'Kompletter Original-Payload des Webhooks (Perspective o.ä.) — für Nachvollziehbarkeit/Debugging.';
