ALTER TABLE public.talentone_projekte
  ADD COLUMN IF NOT EXISTS offer_id uuid REFERENCES public.talentone_offers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS auftrag_checkliste jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'talentone_projekte_offer_id_uniq'
  ) THEN
    CREATE UNIQUE INDEX talentone_projekte_offer_id_uniq
      ON public.talentone_projekte (offer_id)
      WHERE offer_id IS NOT NULL;
  END IF;
END $$;
