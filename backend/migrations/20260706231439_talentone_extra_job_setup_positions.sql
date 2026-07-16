INSERT INTO public.talentone_offer_products
  (brand, category, sku, title, description, unit_price, is_default, sort_order, active)
VALUES
  ('talentone', 'option_setup', 'TO-OPT-EXTRA-JOB-SETUP',
   'Einrichtung weiteres Stellenprofil',
   'Vollständige Einrichtung einer zusätzlichen Stellenkampagne: eigene Qualifikationsseite mit stellenspezifischem Bewerbungsprozess, individuelle Werbemittel und psychologisch aufgebaute Werbetexte für dieses Berufsbild, separate Kampagnenstruktur mit eigener Auswertung in Ihrem Portal. Jede Stelle erhält ihren eigenen, optimierten Auftritt — keine Sammelanzeigen.',
   290.00, false, 45, true),
  ('nowag_wirth', 'option_setup', 'NW-OPT-EXTRA-JOB-SETUP',
   'Einrichtung weiteres Stellenprofil',
   'Vollständige Einrichtung einer zusätzlichen Stellenkampagne: eigene Qualifikationsseite mit stellenspezifischem Bewerbungsprozess, individuelle Werbemittel und psychologisch aufgebaute Werbetexte für dieses Berufsbild, separate Kampagnenstruktur mit eigener Auswertung in Ihrem Portal. Jede Stelle erhält ihren eigenen, optimierten Auftritt — keine Sammelanzeigen. Die Einrichtung erfolgt auf Ihrem eigenen Werbekonto.',
   490.00, false, 65, true)
ON CONFLICT (sku) DO NOTHING;
