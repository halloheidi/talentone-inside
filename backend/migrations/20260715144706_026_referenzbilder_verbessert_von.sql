-- KI-verbesserte Foto-Varianten verweisen auf das Original.
ALTER TABLE talentone_referenzbilder
  ADD COLUMN IF NOT EXISTS verbessert_von uuid REFERENCES talentone_referenzbilder(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS verbesserung_preset text;
CREATE INDEX IF NOT EXISTS idx_referenzbilder_verbessert_von
  ON talentone_referenzbilder(verbessert_von);
COMMENT ON COLUMN talentone_referenzbilder.verbessert_von IS
  'Zeigt auf die Original-Row wenn dies eine per KI verbesserte Version ist.';
COMMENT ON COLUMN talentone_referenzbilder.verbesserung_preset IS
  'Welches Preset wurde beim Verbessern verwendet: qualitaet | setting | hintergrund | perspektive.';
