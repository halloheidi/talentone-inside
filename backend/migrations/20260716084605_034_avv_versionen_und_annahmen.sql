-- AVV (Auftragsverarbeitungsvertrag): Versionen + Annahme-Protokoll.

-- Storage-Bucket fuer Dokumente (PDFs), public read.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dokumente', 'dokumente', true, 20971520, array['application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create table if not exists talentone_avv_versionen (
  id          uuid primary key default gen_random_uuid(),
  agentur     text not null check (agentur in ('talentone', 'nowagwirth')),
  version     text not null,
  pdf_url     text not null,
  gueltig_ab  date not null default current_date,
  created_at  timestamptz not null default now()
);
create index if not exists talentone_avv_versionen_agentur_idx
  on talentone_avv_versionen (agentur, gueltig_ab desc);
alter table talentone_avv_versionen enable row level security;

create table if not exists talentone_avv_annahmen (
  id              uuid primary key default gen_random_uuid(),
  kunde_id        uuid not null references talentone_kunden(id) on delete cascade,
  avv_version_id  uuid not null references talentone_avv_versionen(id) on delete restrict,
  akzeptiert_von  text,
  akzeptiert_email text,
  ip_adresse      text,
  user_agent      text,
  akzeptiert_am   timestamptz not null default now()
);
create index if not exists talentone_avv_annahmen_kunde_idx
  on talentone_avv_annahmen (kunde_id, akzeptiert_am desc);
alter table talentone_avv_annahmen enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'talentone_avv_versionen' and policyname = 'service_role_all') then
    create policy service_role_all on talentone_avv_versionen for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'talentone_avv_annahmen' and policyname = 'service_role_all') then
    create policy service_role_all on talentone_avv_annahmen for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
end $$;

comment on table talentone_avv_versionen is 'AVV-Vertragsversionen pro Agentur. Neueste (gueltig_ab) ist aktiv.';
comment on table talentone_avv_annahmen is 'Protokoll der AVV-Annahmen pro Kunde (Name, E-Mail, IP, User-Agent, Zeitpunkt, Version).';
