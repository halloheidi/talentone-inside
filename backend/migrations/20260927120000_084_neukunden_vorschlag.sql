-- Daten-Vorschlag aus hochgeladenen Formularen (PDF/DOCX) für Neukundengewinnungs-Projekte.
-- KI-extrahierte neukunden_daten-Felder werden NIE direkt gespeichert, sondern hier als
-- Vorschlag geparkt; der Mitarbeiter übernimmt im Neukunden-Tab Feld für Feld.
-- Shape: { dateiname, quelle_url, vorschlag: {produkt, kundenprofil, zielgruppe,
--          einzugsgebiet, preisrahmen, vorteile[], unterschied}, erstellt_am }
-- NULL = kein offener Vorschlag.
alter table talentone_jobs add column if not exists neukunden_vorschlag jsonb;

comment on column talentone_jobs.neukunden_vorschlag is
  'Offener Daten-Vorschlag aus einem hochgeladenen Formular (Neukunden). Feld-für-Feld übernehmbar; NULL = keiner.';
