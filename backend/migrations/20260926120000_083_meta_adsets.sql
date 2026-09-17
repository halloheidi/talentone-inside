-- Ad-Set-Ebene für gemischte Meta-Kampagnen (eine Kampagne bedient mehrere Stellen
-- über Anzeigengruppen, z. B. Bizjak: Ad Set "Autohelfer" in der Mechatroniker-Kampagne).
-- Kampagnen-Insights bleiben führend für UNGEMISCHTE Kampagnen; für gemischte kommt die
-- Attribution aus den Ad-Set-Insights (kein Doppelzählen).

-- Kampagne als "gemischt" markieren → Kampagnen-Zuordnung wird durch Ad-Set-Zuordnung ersetzt.
alter table talentone_meta_kampagnen
  add column if not exists gemischt boolean not null default false;

comment on column talentone_meta_kampagnen.gemischt is
  'Bedient mehrere Stellen über Anzeigengruppen. Wenn true: Kampagnen-Zuordnung (projekt_id) wird ignoriert, Attribution läuft pro Ad Set (talentone_meta_adsets).';

-- Anzeigengruppen (Ad Sets)
create table if not exists talentone_meta_adsets (
  id               uuid primary key default gen_random_uuid(),
  meta_adset_id    text not null unique,
  meta_campaign_id text not null,
  werbekonto_id    text,
  name             text,
  effective_status text,
  meta_start_time  timestamptz,
  projekt_id       uuid references talentone_projekte(id) on delete set null,
  job_id           uuid references talentone_jobs(id) on delete set null,
  kunde_id         uuid references talentone_kunden(id) on delete set null,
  vorheriger_status text,
  zuletzt_gesynct  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists talentone_meta_adsets_campaign_idx on talentone_meta_adsets (meta_campaign_id);
create index if not exists talentone_meta_adsets_projekt_idx on talentone_meta_adsets (projekt_id);
create index if not exists talentone_meta_adsets_konto_idx on talentone_meta_adsets (werbekonto_id);

-- Tages-Insights auf Ad-Set-Ebene (nur für Ad Sets gemischter Kampagnen gezogen).
create table if not exists talentone_meta_adset_insights (
  meta_adset_id    text not null,
  meta_campaign_id text not null,
  datum            date not null,
  spend            numeric,
  impressions      bigint,
  clicks           bigint,
  ctr              numeric,
  cpm              numeric,
  leads            integer,
  updated_at       timestamptz not null default now(),
  primary key (meta_adset_id, datum)
);
create index if not exists talentone_meta_adset_insights_campaign_idx on talentone_meta_adset_insights (meta_campaign_id);

alter table talentone_meta_adsets enable row level security;
alter table talentone_meta_adset_insights enable row level security;
