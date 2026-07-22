-- Im Funnel gewaehlte Stelle (aus der Formular-Antwort), unabhaengig von der
-- Job-Zuordnung. Fuer Kunden wie Clivet, bei denen alle Bewerbungen in EIN
-- Projekt laufen und die konkrete Stelle nur aus der Payload-Antwort kommt.
alter table talentone_bewerbungen
  add column if not exists stelle_gewaehlt text;

comment on column talentone_bewerbungen.stelle_gewaehlt is 'Im Funnel gewaehlte Stelle/Position aus der Formular-Antwort (Label-Match Stelle/Position/Job). NULL = keine Stellen-Antwort im Payload. Quelle fuer Sheet-Spalte A und die Tool-Anzeige.';
