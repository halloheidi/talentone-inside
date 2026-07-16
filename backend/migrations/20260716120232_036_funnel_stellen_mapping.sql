-- Kunden-Webhook: ein externer Funnel bedient mehrere Stellen. Mapping der
-- Stellenauswahl-Antwort auf den richtigen Job (am Kunden gespeichert, gilt für
-- alle Projekte des Kunden).
alter table talentone_kunden
  add column if not exists funnel_stellen_mapping jsonb not null default '{}'::jsonb;

comment on column talentone_kunden.funnel_stellen_mapping is
  'Multi-Stellen-Funnel-Mapping: { aktiv: bool, regeln: [{enthaelt: text, job_id: uuid}], default_job_id: uuid|null }. Case-insensitiver Teilstring-Match der Stellenauswahl-Antwort.';

-- Bewerbung ohne eindeutige Stellenzuordnung markieren (für Warnung + Umzuordnung).
alter table talentone_bewerbungen
  add column if not exists zuordnung_unklar boolean not null default false;

comment on column talentone_bewerbungen.zuordnung_unklar is
  'true = kam über Kunden-Webhook, konnte aber per Mapping keiner Stelle eindeutig zugeordnet werden (Fallback-Job). Für Review/Umzuordnung.';

create index if not exists talentone_bewerbungen_zuordnung_unklar_idx
  on talentone_bewerbungen (zuordnung_unklar) where zuordnung_unklar = true;
