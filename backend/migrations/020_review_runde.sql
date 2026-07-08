-- Migration 020: talentone_reviews.runde für zweite Feedbackschleife.
--
-- Bisher überschrieb der Review-Endpoint den Feedback-Eintrag pro Job.
-- Ab jetzt ist jede Iteration eine eigene Row mit einer laufenden Nummer,
-- damit die alten Kommentare erhalten bleiben und im Kunden-Frontend als
-- „Dein Feedback aus Runde N" einklappbar dargestellt werden können.

ALTER TABLE public.talentone_reviews
  ADD COLUMN IF NOT EXISTS runde integer NOT NULL DEFAULT 1;

-- Bestehende Rows behalten runde=1 (default). Neue Runden brauchen einen
-- neuen Token, damit der Kunde die aktuelle Fassung öffnet und alte Reviews
-- nicht mehr editierbar sind (Token ist per Job-DB-UNIQUE hinterlegt —
-- deshalb Unique-Constraint für runde+job_id ergänzen).

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
