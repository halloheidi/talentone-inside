-- Logos (klein, max 5 MB)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('talentone-logos', 'talentone-logos', true, 5242880,
        array['image/png','image/jpeg','image/svg+xml','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Referenzbilder (Fotos vom Arbeitsplatz / Team etc.)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('talentone-referenzbilder', 'talentone-referenzbilder', true, 20971520,
        array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Metadaten für Referenzbilder + (optional) hochgeladene Logos.
-- Logos werden zusätzlich auch direkt in talentone_kunden.logo_url denormalisiert
-- (für schnellen Lookup beim Creative-Generieren).
create table if not exists public.talentone_referenzbilder (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  kunde_id      uuid not null references public.talentone_kunden(id) on delete cascade,
  bild_url      text not null,
  typ           text not null default 'foto' check (typ in ('foto','logo')),
  label         text,
  uploaded_via  text not null default 'mitarbeiter' check (uploaded_via in ('mitarbeiter','kunde'))
);
create index if not exists talentone_referenzbilder_kunde_id_idx on public.talentone_referenzbilder(kunde_id);
alter table public.talentone_referenzbilder enable row level security;

-- Upload-Token für Kunden-Self-Upload-Seite (eindeutiger Link pro Kunde).
alter table public.talentone_kunden
  add column if not exists upload_token text unique;
