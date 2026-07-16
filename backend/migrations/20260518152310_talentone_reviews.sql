-- Review-Token am Job (persistent über mehrere Mail-Versände)
alter table public.talentone_jobs
  add column if not exists review_token text unique;
create index if not exists talentone_jobs_review_token_idx on public.talentone_jobs(review_token);

-- Reviews — vom Kunden über Public-Page abgeschickt
create table if not exists public.talentone_reviews (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  job_id       uuid not null references public.talentone_jobs(id) on delete cascade,
  token        text not null,
  status       text not null default 'offen' check (status in ('offen', 'freigegeben', 'aenderungen')),
  kommentare   jsonb
);
create index if not exists talentone_reviews_job_id_idx on public.talentone_reviews(job_id);
create index if not exists talentone_reviews_token_idx on public.talentone_reviews(token);
alter table public.talentone_reviews enable row level security;

-- Auto-updated_at via Trigger
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists talentone_reviews_updated on public.talentone_reviews;
create trigger talentone_reviews_updated before update on public.talentone_reviews
  for each row execute function set_updated_at();
