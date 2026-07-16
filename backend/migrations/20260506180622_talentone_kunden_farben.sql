alter table public.talentone_kunden
  add column if not exists farben jsonb;
comment on column public.talentone_kunden.farben is
  'Markenfarben — z.B. {"primaer":"#1a5c3a","sekundaer":"#f0c040","akzent":"#ffffff"}. Wird beim Anlegen aus URL oder Logo automatisch befüllt, ist aber editierbar.';
