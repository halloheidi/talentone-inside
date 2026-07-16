alter table public.talentone_funnels
  add column if not exists screens jsonb;
comment on column public.talentone_funnels.screens is
  'Funnel-Screens als geordnete Liste. Types: intro|benefits|tasks|question|contact. Pro Screen u.a. headline, body, image_url, type-spezifische Felder.';
