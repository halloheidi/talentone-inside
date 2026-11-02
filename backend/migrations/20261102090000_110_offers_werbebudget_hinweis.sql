-- 110 — Werbebudget-Pflichtblock + schlankes KI-PDF.
-- Rein additiv: ein editierbarer Werbebudget-Hinweis je Angebot (KI-Variante).
-- Der Text erscheint als eigener TEXT-Block im easybill-PDF und auf der
-- Annahme-Seite; die Höhe wird nie erfunden (fehlt sie → offener Punkt).

ALTER TABLE talentone_offers
  ADD COLUMN IF NOT EXISTS werbebudget_hinweis text;
