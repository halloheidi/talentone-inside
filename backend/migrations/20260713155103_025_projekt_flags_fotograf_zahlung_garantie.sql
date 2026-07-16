ALTER TABLE talentone_projekte
  ADD COLUMN IF NOT EXISTS fotograf_noetig     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS zahlung_aufgeteilt  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS garantie            BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS garantie_details    TEXT,
  ADD COLUMN IF NOT EXISTS agentur             TEXT;

COMMENT ON COLUMN talentone_projekte.fotograf_noetig    IS 'Nur relevant bei Nowag-&-Wirth-Projekten: muss ein Fotograf organisiert werden? Steuert die dynamische Checkliste.';
COMMENT ON COLUMN talentone_projekte.zahlung_aufgeteilt IS 'Interne Info: wird die Kundenzahlung intern aufgeteilt? Beeinflusst nur unsere Abrechnung, nicht den Kunden.';
COMMENT ON COLUMN talentone_projekte.garantie           IS 'Wurde eine Garantie zugesagt? Details in garantie_details.';
COMMENT ON COLUMN talentone_projekte.garantie_details   IS 'Freitext-Beschreibung der Garantie, z. B. "Einstellungsgarantie 30 Tage".';
COMMENT ON COLUMN talentone_projekte.agentur            IS 'Agentur des Projekts (talentone | nowagwirth) — Snapshot vom Kunden zum Zeitpunkt der Anlage. Steuert die dynamische Checkliste.';

-- Bestehende Projekte: agentur aus dem verknüpften Kunden nachziehen.
UPDATE talentone_projekte p
SET agentur = k.agentur
FROM talentone_kunden k
WHERE p.agentur IS NULL AND k.id = p.kunde_id AND k.agentur IS NOT NULL;
