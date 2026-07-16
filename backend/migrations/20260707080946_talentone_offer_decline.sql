ALTER TABLE public.talentone_offers
  ADD COLUMN IF NOT EXISTS decline_note text,
  ADD COLUMN IF NOT EXISTS declined_at  timestamptz;
