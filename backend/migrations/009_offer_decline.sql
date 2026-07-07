-- Migration 009: Ablehnungs-Felder am Angebot (Phase 6).
-- Wird über POST /api/offers/:id/decline gesetzt (Pflicht-Notiz).

ALTER TABLE public.talentone_offers
  ADD COLUMN IF NOT EXISTS decline_note text,
  ADD COLUMN IF NOT EXISTS declined_at  timestamptz;
