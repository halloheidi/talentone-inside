-- Kunden-Flag: Keine KI-Bilder gewuenscht.
ALTER TABLE talentone_kunden ADD COLUMN IF NOT EXISTS keine_ki_bilder boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN talentone_kunden.keine_ki_bilder IS
  'Wenn true: KI-Bild-Modi werden im Creatives-Tab ausgeblendet/gewarnt, Overlay-Modus ist Default.';

-- creatives.typ um 'overlay' erweitern. Bestehender Check-Constraint existiert nur wenn CHECK gesetzt war.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name LIKE 'talentone_creatives_typ%'
  ) THEN
    ALTER TABLE talentone_creatives DROP CONSTRAINT IF EXISTS talentone_creatives_typ_check;
  END IF;
END $$;
-- Neue Constraint, akzeptiert 'bild', 'video', 'overlay'.
ALTER TABLE talentone_creatives
  ADD CONSTRAINT talentone_creatives_typ_check
  CHECK (typ IN ('bild', 'video', 'overlay'));
