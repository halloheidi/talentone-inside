ALTER TABLE public.talentone_creatives
  ADD COLUMN IF NOT EXISTS archiviert boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS talentone_creatives_archiviert_idx
  ON public.talentone_creatives (archiviert)
  WHERE archiviert = false;

ALTER TABLE public.talentone_projekte
  ADD COLUMN IF NOT EXISTS live_termin                 date,
  ADD COLUMN IF NOT EXISTS reminder_gesendet_at        timestamptz,
  ADD COLUMN IF NOT EXISTS creative_auftrag_gesendet_at timestamptz;
