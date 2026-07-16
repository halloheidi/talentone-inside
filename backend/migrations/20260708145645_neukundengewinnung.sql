ALTER TABLE public.talentone_jobs
  ADD COLUMN IF NOT EXISTS projekttyp        text NOT NULL DEFAULT 'mitarbeitergewinnung',
  ADD COLUMN IF NOT EXISTS anfragen_token    text,
  ADD COLUMN IF NOT EXISTS neukunden_daten   jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_schema = 'public'
      AND constraint_name = 'talentone_jobs_projekttyp_check'
  ) THEN
    ALTER TABLE public.talentone_jobs
      ADD CONSTRAINT talentone_jobs_projekttyp_check
      CHECK (projekttyp IN ('mitarbeitergewinnung', 'neukundengewinnung'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'talentone_jobs_anfragen_token_uniq'
  ) THEN
    CREATE UNIQUE INDEX talentone_jobs_anfragen_token_uniq
      ON public.talentone_jobs (anfragen_token)
      WHERE anfragen_token IS NOT NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.talentone_anfragen (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      uuid NOT NULL REFERENCES public.talentone_jobs(id) ON DELETE CASCADE,
  name        text,
  email       text,
  telefon     text,
  daten       jsonb NOT NULL DEFAULT '{}'::jsonb,
  quelle      text,
  status      text NOT NULL DEFAULT 'neu',
  notizen     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_schema = 'public'
      AND constraint_name = 'talentone_anfragen_status_check'
  ) THEN
    ALTER TABLE public.talentone_anfragen
      ADD CONSTRAINT talentone_anfragen_status_check
      CHECK (status IN ('neu', 'kontaktiert', 'termin', 'gewonnen', 'verloren'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS talentone_anfragen_job_idx ON public.talentone_anfragen (job_id);
CREATE INDEX IF NOT EXISTS talentone_anfragen_status_idx ON public.talentone_anfragen (status);

ALTER TABLE public.talentone_anfragen ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_talentone_anfragen_upd ON public.talentone_anfragen;
CREATE TRIGGER trg_talentone_anfragen_upd
  BEFORE UPDATE ON public.talentone_anfragen
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
