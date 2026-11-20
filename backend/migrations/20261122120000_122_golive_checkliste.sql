-- Go-Live-Checkliste je Stelle (Funnel-Bereich).
-- Speichert die MANUELLEN Haken als { "<key>": { "done": true, "at": "<iso>", "by": "<email>" } }.
-- Auto-Haken (Funnel live, Test-Bewerbung, Pixel-Event, Kampagne zugeordnet) werden
-- NICHT gespeichert, sondern bei GET /api/jobs/:id/golive aus den Live-Daten berechnet.
alter table talentone_jobs
  add column if not exists golive_checkliste jsonb not null default '{}'::jsonb;
