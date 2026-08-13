-- Pro Angebot ein Positions-Snapshot: die tatsächlich verwendeten Werte
-- (Bezeichnung, Beschreibung, Einzelpreis netto in Euro, Menge, Kategorie) inkl.
-- manueller Overrides und freier Positionen. Downstream (AB, Setup-/Monats-
-- Rechnung, Controlling/MRR) rechnet mit diesem Snapshot statt mit dem Katalog.
-- Leeres Array = Alt-Angebot ohne Snapshot → Consumer fallen auf den Katalog zurück.
ALTER TABLE talentone_offers
  ADD COLUMN IF NOT EXISTS positions_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb;
