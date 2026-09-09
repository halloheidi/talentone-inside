-- 066: Verknüpfung Kampagnen-Job ↔ Projektübersicht + Kampagnen-Reminder-Feld.
-- talentone_jobs (Kampagnen unter Kunden) und talentone_projekte (Projektübersicht,
-- ex-Airtable) waren getrennt. Neue nullable FK-Spalte verbindet sie; Tabellen bleiben
-- getrennt (nur verknüpfen + gegenseitig anzeigen).
alter table talentone_jobs
  add column if not exists projekt_id uuid references talentone_projekte(id) on delete set null;
create index if not exists idx_talentone_jobs_projekt_id on talentone_jobs(projekt_id);

-- Doppelversand-Schutz für den 30/60/90-Tage-Kampagnen-Reminder. Bewusst NICHT
-- reminder_gesendet_at (existiert für einen anderen Mechanismus).
alter table talentone_projekte
  add column if not exists kampagnen_reminder_letzter date;
