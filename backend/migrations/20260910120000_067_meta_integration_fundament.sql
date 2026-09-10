-- 067: Fundament Meta-Marketing-API-Integration (Phase 1, nur lesend).
-- Kampagnen laufen über den eigenen Business Manager (eigene + Partner-Werbekonten).
-- Der System-User-Token (ads_read, read_insights) wird serverseitig gehalten
-- (talentone_settings.schluessel='meta_system_user_token' ODER env META_SYSTEM_USER_TOKEN),
-- NIE im Frontend. Achtung: Leerzeichen in .env-Werten crashen den Serverstart → beim
-- Lesen trimmen.

create table if not exists talentone_settings (
  schluessel text primary key,
  wert text,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists talentone_meta_kampagnen (
  id uuid primary key default gen_random_uuid(),
  meta_campaign_id text unique not null,
  werbekonto_id text not null,
  name text,
  meta_start_time timestamptz,
  effective_status text,
  daily_budget numeric,
  lifetime_budget numeric,
  projekt_id uuid references talentone_projekte(id) on delete set null,
  job_id uuid references talentone_jobs(id) on delete set null,
  vorheriger_status text,
  zuletzt_gesynct timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_meta_kampagnen_projekt on talentone_meta_kampagnen(projekt_id);
create index if not exists idx_meta_kampagnen_werbekonto on talentone_meta_kampagnen(werbekonto_id);

create table if not exists talentone_meta_insights (
  meta_campaign_id text not null,
  datum date not null,
  spend numeric,
  impressions bigint,
  clicks bigint,
  ctr numeric,
  cpm numeric,
  leads integer,
  results integer,
  updated_at timestamptz not null default now(),
  primary key (meta_campaign_id, datum)
);
create index if not exists idx_meta_insights_datum on talentone_meta_insights(datum);

alter table talentone_projekte add column if not exists meta_werbekonto_id text;
alter table talentone_jobs     add column if not exists meta_werbekonto_id text;
