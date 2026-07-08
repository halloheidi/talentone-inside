-- Migration 019: Sammelmigration für die Ausbaustufe „Ausbau X":
--
--   T1 — talentone_creatives.archiviert (bool, default false).
--        Archivierte Creatives verschwinden aus der Galerie, bleiben aber
--        in DB + Storage. Endgültiges Löschen nur aus der Archiv-Ansicht.
--
--   T7 — talentone_projekte.live_termin (date, nullable).
--        Der geplante Go-Live-Termin. Editierbar im Projekt-Slide-Over.
--        Reminder-Flags dazu, damit der Cron pro Projekt max. 1× triggert.

ALTER TABLE public.talentone_creatives
  ADD COLUMN IF NOT EXISTS archiviert boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS talentone_creatives_archiviert_idx
  ON public.talentone_creatives (archiviert)
  WHERE archiviert = false;

ALTER TABLE public.talentone_projekte
  ADD COLUMN IF NOT EXISTS live_termin                 date,
  ADD COLUMN IF NOT EXISTS reminder_gesendet_at        timestamptz,
  ADD COLUMN IF NOT EXISTS creative_auftrag_gesendet_at timestamptz;
