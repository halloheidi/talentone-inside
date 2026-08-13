-- Pro Ad-Copy-Variante zusätzliche Meta-Ad-Überschriften (Headlines, ~40 Zeichen).
-- Ergänzt den Fließtext; wird vom Ad-Copy-Generator mitgeliefert.
ALTER TABLE talentone_adcopies
  ADD COLUMN IF NOT EXISTS ueberschriften jsonb NOT NULL DEFAULT '[]'::jsonb;
