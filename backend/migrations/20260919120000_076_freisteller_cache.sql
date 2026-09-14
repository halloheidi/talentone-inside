-- Cache für Personen-Freisteller (Hintergrund-Entfernung) pro Referenzbild.
-- Vermeidet wiederholte (kostenpflichtige) remove.bg-Aufrufe für dasselbe Foto.
create table if not exists talentone_freisteller (
  referenzbild_id uuid primary key references talentone_referenzbilder(id) on delete cascade,
  cutout_url text,                 -- freigestelltes PNG (transparenter Hintergrund)
  ok boolean not null default false,
  reason text,                     -- Fehlermeldung, falls ok=false
  created_at timestamptz not null default now()
);
