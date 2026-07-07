-- Migration 017: Projekt-Automatik-Anbindung an angenommene Angebote.
--
--   - offer_id (uuid, nullable, UNIQUE): verlinkt eine Projekt-Card auf das
--     zugehörige Angebot. UNIQUE garantiert Idempotenz — der Sync-Lauf und der
--     Direkt-AB-Endpoint erzeugen bei erneutem Trigger keine zweite Card.
--   - auftrag_checkliste (jsonb, default '[]'): dynamische Liste, die aus den
--     gewählten Positionen des Angebots abgeleitet wird. Format:
--       [{ key: 'onboarding_call', label: 'Onboarding-Call', done: false }, ...]
--     Trennt sich von der bestehenden generischen `checkliste`-Sync-Logik in
--     projekt-sync.js.

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
