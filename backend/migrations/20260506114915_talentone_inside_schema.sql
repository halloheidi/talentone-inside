-- TalentOne Inside (interner Kampagnen-Tool) — Schema
-- Alle Tabellen mit talentone_ Prefix, RLS aktiviert.
-- Backend zugreift via Service Role Key (bypasst RLS).
-- Direkter Frontend-Zugriff (anon/authenticated) ist blockiert — Frontend geht über das Backend.

create extension if not exists "pgcrypto";

-- 1) Kunden
create table if not exists public.talentone_kunden (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  firmenname      text,
  ansprechpartner text,
  email           text,
  telefon         text,
  logo_url        text,
  branche         text,
  notizen         text
);
comment on table public.talentone_kunden is 'TalentOne Inside — Kunden (Firmen, für die Recruiting-Kampagnen erstellt werden).';

-- 2) Jobs
create table if not exists public.talentone_jobs (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  kunde_id            uuid not null references public.talentone_kunden(id) on delete cascade,
  stelle              text,
  region              text,
  gehalt              text,
  benefits            jsonb,
  besonderheiten      text,
  reisebereitschaft   boolean,
  quereinsteiger      boolean,
  eingabe_methode     text,
  url                 text,
  formdata_komplett   jsonb,
  analyse_ergebnis    jsonb,
  analyse_id          uuid references public.talentone_analysen(id) on delete set null
);
create index if not exists talentone_jobs_kunde_id_idx on public.talentone_jobs(kunde_id);
create index if not exists talentone_jobs_analyse_id_idx on public.talentone_jobs(analyse_id);
comment on table public.talentone_jobs is 'TalentOne Inside — Stellen pro Kunde, optional verlinkt mit talentone_analysen.';

-- 3) Creatives
create table if not exists public.talentone_creatives (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  job_id      uuid not null references public.talentone_jobs(id) on delete cascade,
  bild_url    text,
  format      text check (format in ('quadrat','story')),
  typ         text check (typ in ('bild','video')),
  prompt      text,
  status      text
);
create index if not exists talentone_creatives_job_id_idx on public.talentone_creatives(job_id);
comment on table public.talentone_creatives is 'TalentOne Inside — Werbe-Creatives (Bilder/Videos in versch. Formaten) pro Job.';

-- 4) Ad Copies
create table if not exists public.talentone_adcopies (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  job_id      uuid not null references public.talentone_jobs(id) on delete cascade,
  stil        text,
  text        text,
  bearbeitet  boolean not null default false
);
create index if not exists talentone_adcopies_job_id_idx on public.talentone_adcopies(job_id);
comment on table public.talentone_adcopies is 'TalentOne Inside — Werbetexte (verschiedene Stile) pro Job.';

-- 5) Funnels
create table if not exists public.talentone_funnels (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  job_id      uuid not null references public.talentone_jobs(id) on delete cascade,
  fragen      jsonb,
  pixel_id    text
);
create index if not exists talentone_funnels_job_id_idx on public.talentone_funnels(job_id);
comment on table public.talentone_funnels is 'TalentOne Inside — Bewerbungs-Funnel (Fragen + optional Tracking-Pixel) pro Job.';

-- RLS aktivieren (Service Role bypasst RLS automatisch, anon/authenticated bleiben gesperrt)
alter table public.talentone_kunden    enable row level security;
alter table public.talentone_jobs      enable row level security;
alter table public.talentone_creatives enable row level security;
alter table public.talentone_adcopies  enable row level security;
alter table public.talentone_funnels   enable row level security;
