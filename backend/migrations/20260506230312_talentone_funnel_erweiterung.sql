-- Funnel-Felder erweitern
alter table public.talentone_funnels
  add column if not exists bilder jsonb,
  add column if not exists conversion_ziel text default 'Bewerbung einreichen',
  add column if not exists veroeffentlicht boolean not null default false;

-- Bewerbungen — die Submissions vom Public-Funnel
create table if not exists public.talentone_bewerbungen (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  funnel_id   uuid not null references public.talentone_funnels(id) on delete cascade,
  job_id      uuid references public.talentone_jobs(id) on delete set null,
  name        text,
  email       text,
  telefon     text,
  antworten   jsonb
);
create index if not exists talentone_bewerbungen_funnel_id_idx on public.talentone_bewerbungen(funnel_id);
create index if not exists talentone_bewerbungen_job_id_idx on public.talentone_bewerbungen(job_id);
alter table public.talentone_bewerbungen enable row level security;

-- Bucket für Funnel-Stimmungsbilder (10 MB, png/jpeg/webp)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('talentone-funnel-bilder', 'talentone-funnel-bilder', true, 10485760,
        array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
