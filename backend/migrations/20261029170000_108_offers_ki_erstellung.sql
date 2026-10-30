-- 108 — Angebote "Individuell mit KI": additive Spalten auf talentone_offers.
-- Rein additiv: der bestehende Baukasten-Pfad ist davon unberührt. Alt-Angebote
-- bekommen erstellt_via='baukasten' per Default; alle neuen KI-Felder sind
-- nullbar bzw. leere Defaults, Downstream (easybill-Builder, resolveOfferPositions,
-- Annahme→Projekt) funktioniert ohne sie weiter.

ALTER TABLE talentone_offers
  -- Erstellungsweg: unterscheidet Baukasten vom KI-Editor (nur für UI/Reporting).
  ADD COLUMN IF NOT EXISTS erstellt_via text NOT NULL DEFAULT 'baukasten',
  -- KI-Kontext-Snapshot: Freitext, gewählte Close-Einträge (IDs + Kurz-Snapshot),
  -- angehakte Bausteine, Kundenakte-Auszug — für Nachvollziehbarkeit/Reproduktion.
  ADD COLUMN IF NOT EXISTS ki_kontext jsonb,
  -- Versions-Historie des KI-Entwurfs (für "zurückblättern" beim Nachschärfen).
  ADD COLUMN IF NOT EXISTS ki_versionen jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Freitext-Blöcke des Angebots (erscheinen als TEXT-Positionen im easybill-Doc).
  ADD COLUMN IF NOT EXISTS einleitung text,
  ADD COLUMN IF NOT EXISTS leistungsbeschreibung text,
  -- Optionaler Zahlungsbedingungen-Override (sonst greift das Marken-Template).
  ADD COLUMN IF NOT EXISTS zahlungsbedingungen text,
  -- Gültigkeit + offene Punkte (fehlende Preise etc.) aus der KI-Generierung.
  ADD COLUMN IF NOT EXISTS gueltig_bis date,
  ADD COLUMN IF NOT EXISTS offene_punkte jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Vertragsmodell/Laufzeit am Angebot, damit die Annahme das Projekt vorbelegt.
  ADD COLUMN IF NOT EXISTS vertragsmodell text,
  ADD COLUMN IF NOT EXISTS laufzeit_wert integer,
  ADD COLUMN IF NOT EXISTS laufzeit_einheit text;

-- erstellt_via: nur die zwei bekannten Wege.
ALTER TABLE talentone_offers DROP CONSTRAINT IF EXISTS talentone_offers_erstellt_via_chk;
ALTER TABLE talentone_offers
  ADD CONSTRAINT talentone_offers_erstellt_via_chk
  CHECK (erstellt_via IN ('baukasten', 'ki'));

-- Vertragsmodell/Laufzeit: gleiche Wertebereiche wie auf talentone_projekte (Migr. 097).
ALTER TABLE talentone_offers DROP CONSTRAINT IF EXISTS talentone_offers_vertragsmodell_chk;
ALTER TABLE talentone_offers
  ADD CONSTRAINT talentone_offers_vertragsmodell_chk
  CHECK (vertragsmodell IS NULL OR vertragsmodell IN ('kampagne', 'abo'));

ALTER TABLE talentone_offers DROP CONSTRAINT IF EXISTS talentone_offers_laufzeit_einheit_chk;
ALTER TABLE talentone_offers
  ADD CONSTRAINT talentone_offers_laufzeit_einheit_chk
  CHECK (laufzeit_einheit IS NULL OR laufzeit_einheit IN ('tage', 'monate'));
