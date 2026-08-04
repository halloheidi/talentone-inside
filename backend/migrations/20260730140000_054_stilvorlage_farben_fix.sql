-- Vorlagenfarben beibehalten: Standard = Farben an Kunden-CI anpassen (false).
-- true → die Original-Farben der Stilvorlage bleiben (für Vorlagen, bei denen die
-- Farbe selbst der Stil ist, z. B. "Pinselstrich Neongrün").
ALTER TABLE talentone_stilvorlagen ADD COLUMN IF NOT EXISTS farben_fix boolean NOT NULL DEFAULT false;
