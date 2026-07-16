-- KO-Kriterium an Bewerbungen
alter table public.talentone_bewerbungen
  add column if not exists ko_kriterium boolean not null default false;
create index if not exists talentone_bewerbungen_ko_idx on public.talentone_bewerbungen(ko_kriterium);

-- Funnel: Conversion API + Externer Funnel
alter table public.talentone_funnels
  add column if not exists capi_access_token text,
  add column if not exists extern boolean not null default false,
  add column if not exists extern_url text,
  add column if not exists extern_sheet_url text;
comment on column public.talentone_funnels.capi_access_token is
  'Meta Conversions API Access Token (für serverseitiges Event-Tracking)';
comment on column public.talentone_funnels.extern is
  'Wenn true wird ein externer Funnel verwendet (Perspective o.ä.), interner Editor ist deaktiviert';
