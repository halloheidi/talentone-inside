alter table public.talentone_kunden
  add column if not exists website_url text;
comment on column public.talentone_kunden.website_url is
  'Karriereseite oder Homepage des Kunden — wird zum Farb-Scraping genutzt.';
