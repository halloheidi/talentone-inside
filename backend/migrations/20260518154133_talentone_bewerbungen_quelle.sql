-- Quelle der Bewerbung
alter table public.talentone_bewerbungen
  add column if not exists quelle text not null default 'funnel'
  check (quelle in ('funnel', 'perspective'));
create index if not exists talentone_bewerbungen_quelle_idx on public.talentone_bewerbungen(quelle);

-- funnel_id NULL erlauben — Perspective-Webhook hat ggf. keinen internen Funnel
alter table public.talentone_bewerbungen
  alter column funnel_id drop not null;
