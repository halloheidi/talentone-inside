-- Tab-Häkchen: manuelle Erledigt-Overrides pro Job-Tab (stelle/creatives/adcopies/funnel/export).
-- Auto-Erkennung passiert im Backend (tab-status.js); hier nur die manuellen Overrides.
alter table talentone_jobs
  add column if not exists tab_status jsonb not null default '{}'::jsonb;

comment on column talentone_jobs.tab_status is
  'Manuelle Erledigt-Overrides pro Tab: { stelle|creatives|adcopies|funnel|export: boolean }. Manuell schlägt Auto-Erkennung. Leeres Objekt = alles Auto.';
