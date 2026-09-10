-- 069: Meta-Konto-Zuordnung (Exklusiv- vs. Pool-Konten) + Kampagnen-Kunde-Hinweis.
-- Exklusiv-Konto → einem Kunden zugeordnet (talentone_kunden.meta_werbekonto_id);
-- Projekte erben, pro Projekt via talentone_projekte.meta_werbekonto_id überschreibbar.
-- Pool-Konto → keine Kunden-Zuordnung; Attribution ausschließlich per Kampagnen-Matching.
alter table talentone_kunden add column if not exists meta_werbekonto_id text;

create table if not exists talentone_meta_konten (
  konto_id text primary key,           -- act_<id>
  name text,
  typ text not null default 'pool' check (typ in ('exklusiv','pool')),
  kunde_id uuid references talentone_kunden(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Attribution bleibt projekt_id-basiert; kunde_id ist nur Hinweis (Nicht-zugeordnet-Liste,
-- Exklusiv-Konto-Vorfilter).
alter table talentone_meta_kampagnen add column if not exists kunde_id uuid references talentone_kunden(id) on delete set null;
