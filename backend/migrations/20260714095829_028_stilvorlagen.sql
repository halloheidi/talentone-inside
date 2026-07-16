CREATE TABLE IF NOT EXISTS talentone_stilvorlagen (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT NOT NULL,
  beschreibung         TEXT,
  layout_prompt        TEXT NOT NULL,
  vorschau_url         TEXT,
  referenzbild_nutzen  BOOLEAN NOT NULL DEFAULT FALSE,
  aktiv                BOOLEAN NOT NULL DEFAULT TRUE,
  reihenfolge          INTEGER NOT NULL DEFAULT 100,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE talentone_stilvorlagen IS
  'Layout-/Stil-Vorlagen fuer die Creative-Generierung. Der Text in layout_prompt ersetzt den festen Layout-Baustein des Prompts an gpt-image-2 und kann Platzhalter wie {stelle_gross}, {meta_leiste}, {hook}, {benefits_liste}, {firmenname}, {farben_hinweis} enthalten.';

CREATE INDEX IF NOT EXISTS talentone_stilvorlagen_aktiv_idx
  ON talentone_stilvorlagen(aktiv, reihenfolge)
  WHERE aktiv = TRUE;

ALTER TABLE talentone_creatives
  ADD COLUMN IF NOT EXISTS stilvorlage_id UUID REFERENCES talentone_stilvorlagen(id) ON DELETE SET NULL;

COMMENT ON COLUMN talentone_creatives.stilvorlage_id IS
  'Welche Stilvorlage wurde beim Generieren verwendet. NULL bei Alt-Bestand + Uploads.';

ALTER TABLE talentone_stilvorlagen ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'talentone_stilvorlagen' AND policyname = 'service_role_all') THEN
    CREATE POLICY service_role_all ON talentone_stilvorlagen FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;
