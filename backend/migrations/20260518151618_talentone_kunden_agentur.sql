alter table public.talentone_kunden
  add column if not exists agentur text not null default 'talentone'
  check (agentur in ('talentone', 'nowagwirth'));
comment on column public.talentone_kunden.agentur is
  'Welche Agentur den Kunden betreut — beeinflusst Mail-Branding/Absender.';
