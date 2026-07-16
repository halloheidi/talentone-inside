create table public.talentone_analysen (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  firmenname text,
  ansprechpartner text,
  email text,
  telefon text,
  stelle text,
  region text,
  branche text,
  gehalt text,
  benefits text,
  besonderheiten text,
  eingabe_methode text check (eingabe_methode in ('neu', 'pdf', 'url')),
  url text,
  formdata_komplett jsonb,
  analyse_ergebnis jsonb,
  close_lead_id text,
  bild_url text
);

create index talentone_analysen_email_idx on public.talentone_analysen (email);
create index talentone_analysen_created_at_idx on public.talentone_analysen (created_at desc);

alter table public.talentone_analysen enable row level security;

comment on table public.talentone_analysen is 'TalentOne Recruiting-Check Lead-Datenbank — wird vom Backend mit service_role beschrieben, kein public access.';
