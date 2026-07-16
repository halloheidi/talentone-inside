create table if not exists public.talentone_versand (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  job_id       uuid not null references public.talentone_jobs(id) on delete cascade,
  empfaenger   text not null,
  betreff      text,
  inhalte      jsonb,
  gesendet_von text
);
create index if not exists talentone_versand_job_id_idx on public.talentone_versand(job_id);
alter table public.talentone_versand enable row level security;
comment on table public.talentone_versand is 'Versand-Historie für Kunden-Mails mit Kampagnen-Entwürfen';
