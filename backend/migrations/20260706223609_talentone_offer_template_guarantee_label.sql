INSERT INTO public.talentone_offer_templates (brand, key, text) VALUES
  ('talentone',   'guarantee_label', 'Bewerbungsgarantie'),
  ('nowag_wirth', 'guarantee_label', 'Erfolgsgarantie')
ON CONFLICT (brand, key) DO NOTHING;
