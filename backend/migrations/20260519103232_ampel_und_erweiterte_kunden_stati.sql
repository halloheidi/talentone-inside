
-- G: Ampel pro Bewerbung (intern setzbar, public read-only)
ALTER TABLE talentone_bewerber_notizen
  ADD COLUMN IF NOT EXISTS ampel text CHECK (ampel IS NULL OR ampel IN ('gruen','gelb','rot'));

CREATE INDEX IF NOT EXISTS notizen_ampel_idx
  ON talentone_bewerber_notizen (ampel);

-- H: Kunden-Status um "ungeeignet" und "absage" erweitern
-- Prüfen ob ein CHECK existiert; falls ja, droppen und neu anlegen.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name LIKE 'talentone_bewerber_kundenfeedback_status_check%'
  ) THEN
    ALTER TABLE talentone_bewerber_kundenfeedback
      DROP CONSTRAINT IF EXISTS talentone_bewerber_kundenfeedback_status_check;
  END IF;
END $$;
-- Kein neuer CHECK — Validierung übernimmt das Backend (whitelist).;
