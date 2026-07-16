ALTER TABLE public.talentone_reviews
  ADD COLUMN IF NOT EXISTS runde integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'talentone_reviews_job_runde_uniq'
  ) THEN
    CREATE UNIQUE INDEX talentone_reviews_job_runde_uniq
      ON public.talentone_reviews (job_id, runde);
  END IF;
END $$;
