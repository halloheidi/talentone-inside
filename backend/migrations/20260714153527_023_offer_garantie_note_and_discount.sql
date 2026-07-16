-- Garantie-Note (Beschreibungstext) + Rabatt fuer alle Offer-Brands.
ALTER TABLE talentone_offers ADD COLUMN IF NOT EXISTS guarantee_note text;
ALTER TABLE talentone_offers ADD COLUMN IF NOT EXISTS discount_type text CHECK (discount_type IN ('percent','flat'));
ALTER TABLE talentone_offers ADD COLUMN IF NOT EXISTS discount_value numeric(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN talentone_offers.guarantee_note IS 'Freitext-Beschreibung der Garantie fuer Angebot + Auftragsbestaetigung.';
COMMENT ON COLUMN talentone_offers.discount_type IS 'percent | flat. NULL wenn kein Rabatt.';
COMMENT ON COLUMN talentone_offers.discount_value IS 'Bei percent 0-100, bei flat EUR netto. Wird auf setup+ad-budget angewendet.';
