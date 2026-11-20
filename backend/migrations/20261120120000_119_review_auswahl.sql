-- 119: Auswahl der gesendeten Creatives/Ad-Copies je Review-Runde festhalten.
-- Beim Versand (Entwurf + Kampagnen-Update) werden genau die angehakten IDs
-- gespeichert; die Review-Seite rendert ausschliesslich diese. Alte Runden ohne
-- gespeicherte Auswahl (NULL) zeigen weiterhin ALLE Creatives (Fallback).
alter table talentone_reviews
  add column if not exists auswahl jsonb;

comment on column talentone_reviews.auswahl is
  'Gesendete Auswahl je Runde: { creative_ids: uuid[], adcopy_ids: uuid[] }. NULL = alte Runde ohne Auswahl -> Review-Seite zeigt alle.';
