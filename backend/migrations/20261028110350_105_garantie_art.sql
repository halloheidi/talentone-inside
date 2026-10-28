-- 105: Garantie als Typ (garantie_art) statt Haken + Ziel-Zahl.
-- garantie (bool) und garantie_details (Meta-Frist-Quelle für controlling-ops/meta-metriken)
-- bleiben UNVERÄNDERT. garantie_bewerbungen → garantie_ziel (0 non-null, bewegt nur NULLs).
-- Neue Spalten: garantie_art, garantie_position (Freitext „Für welche Position"),
-- garantie_pruefen (Marker für mehrdeutig übernommene Altgarantien).

ALTER TABLE talentone_projekte RENAME COLUMN garantie_bewerbungen TO garantie_ziel;

ALTER TABLE talentone_projekte
  ADD COLUMN IF NOT EXISTS garantie_art text,
  ADD COLUMN IF NOT EXISTS garantie_position text,
  ADD COLUMN IF NOT EXISTS garantie_pruefen boolean NOT NULL DEFAULT false;

ALTER TABLE talentone_projekte DROP CONSTRAINT IF EXISTS talentone_projekte_garantie_art_chk;
ALTER TABLE talentone_projekte
  ADD CONSTRAINT talentone_projekte_garantie_art_chk
  CHECK (garantie_art IS NULL OR garantie_art IN ('einstellung','bewerbungen'));

-- Backfill (nur garantie=true):
-- 1) Details-Text vorhanden → Einstellungsgarantie, Ziel 1 (Spec-Vorrang)
UPDATE talentone_projekte
   SET garantie_art = 'einstellung', garantie_ziel = COALESCE(garantie_ziel, 1)
 WHERE garantie AND coalesce(btrim(garantie_details), '') <> '';
-- 2) Ziel-Zahl gesetzt, noch nicht klassifiziert → Bewerbungsgarantie
UPDATE talentone_projekte
   SET garantie_art = 'bewerbungen'
 WHERE garantie AND garantie_art IS NULL AND garantie_ziel IS NOT NULL;
-- 3) garantie=true ohne Text und ohne Ziel → Einstellungsgarantie-Default + Prüf-Marker
UPDATE talentone_projekte
   SET garantie_art = 'einstellung', garantie_ziel = COALESCE(garantie_ziel, 1), garantie_pruefen = true
 WHERE garantie AND garantie_art IS NULL;
