-- Beispiel-Creatives (Referenzbilder des gewünschten Stils) je Stilvorlage.
-- Erstes Bild dient als vorschau_url (Thumbnail) und als Stil-Referenz für die KI
-- (wenn referenzbild_nutzen aktiv). Mehrere Bilder möglich.
ALTER TABLE talentone_stilvorlagen ADD COLUMN IF NOT EXISTS beispielbild_urls jsonb NOT NULL DEFAULT '[]'::jsonb;
