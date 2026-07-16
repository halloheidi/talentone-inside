alter table public.talentone_creatives
  add column if not exists parent_id uuid references public.talentone_creatives(id) on delete set null;
create index if not exists talentone_creatives_parent_id_idx on public.talentone_creatives(parent_id);
comment on column public.talentone_creatives.parent_id is
  'Verknüpft Videos (typ=video) mit dem Bild-Creative, aus dem sie generiert wurden.';
