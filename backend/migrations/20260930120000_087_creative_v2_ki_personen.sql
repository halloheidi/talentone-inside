-- Creative-Wizard V2 — Etappe 2: Szenen-Komposition (KI-Personen) + Reel.
-- Kennzeichen, dass ein Creative generische KI-Personen enthält (Badge + Versand-Vermerk).
alter table talentone_creatives
  add column if not exists enthaelt_ki_personen boolean not null default false;

-- Erste Nutzung der Szenen-Komposition pro Kunde erfordert Bestätigung „Kunde ist
-- informiert" — Zeitpunkt wird festgehalten (einmalig pro Kunde).
alter table talentone_kunden
  add column if not exists ki_personen_informiert_am timestamptz;

comment on column talentone_creatives.enthaelt_ki_personen is
  'Creative enthält generische KI-Personen (Szenen-Komposition). Badge intern + Vermerk im Entwurfsversand.';
