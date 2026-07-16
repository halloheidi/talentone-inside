-- Optionale Feld-Definitions-Liste pro Job. Wenn gesetzt, rendert das
-- Portal-Slide-Over diese Felder IMMER (auch leer) und behaelt zusaetzliche
-- daten-keys als Custom-Felder.
ALTER TABLE talentone_jobs ADD COLUMN IF NOT EXISTS anfragen_felder jsonb;
COMMENT ON COLUMN talentone_jobs.anfragen_felder IS 'Array von {key, label, typ}. typ: text|textarea|select|date|number.';

-- Fuer den variogreen Freiflaechen-Job: fixe Feldliste analog Airtable.
UPDATE talentone_jobs SET anfragen_felder = '[
  {"key":"Projektname","label":"Projektname","typ":"text"},
  {"key":"Adresse","label":"Adresse","typ":"text"},
  {"key":"Postleitzahl","label":"Postleitzahl","typ":"text"},
  {"key":"Gemeinde","label":"Gemeinde","typ":"text"},
  {"key":"Bundesland","label":"Bundesland","typ":"select","optionen":["Baden-Wuerttemberg","Bayern","Berlin","Brandenburg","Bremen","Hamburg","Hessen","Mecklenburg-Vorpommern","Niedersachsen","Nordrhein-Westfalen","Rheinland-Pfalz","Saarland","Sachsen","Sachsen-Anhalt","Schleswig-Holstein","Thueringen"]},
  {"key":"Standort Freiflaeche","label":"Standort Freiflaeche","typ":"textarea"},
  {"key":"Groesse der Flaeche","label":"Groesse der Flaeche","typ":"text"},
  {"key":"Aktuelle Flaechennutzung","label":"Aktuelle Flaechennutzung","typ":"text"},
  {"key":"Privilegiert","label":"Privilegiert","typ":"select","optionen":["Ja","Nein","Unklar"]},
  {"key":"Ab wann ist die Flaeche verfuegbar?","label":"Ab wann verfuegbar?","typ":"text"},
  {"key":"Beste Erreichbarkeit","label":"Beste Erreichbarkeit","typ":"text"},
  {"key":"Telefon (Festnetz)","label":"Telefon (Festnetz)","typ":"text"},
  {"key":"Flaecheninformationen","label":"Flaecheninformationen","typ":"textarea"},
  {"key":"Anmerkung","label":"Anmerkung (Airtable)","typ":"textarea"}
]'::jsonb
WHERE id = '6a607eda-a0a8-4abb-a43b-f6e329a45eeb';
