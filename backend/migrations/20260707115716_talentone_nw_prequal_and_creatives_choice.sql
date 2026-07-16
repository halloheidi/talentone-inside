UPDATE public.talentone_offer_products
SET unit_price = 1490.00,
    title = 'Kampagnen-Betreuung & Bewerbermanagement (monatlich)',
    description = 'Betreuung der Kampagnen auf täglicher Basis mit der NOWI® Methode, Optimierung der Strategie, Test neuer Werbetexte, kontinuierliche Messung. 5 Tage pro Woche Unterstützung durch Ihren persönlichen Partnermanager, WhatsApp-Gruppe, wöchentliche Video-Konferenzen zur Optimierung Ihrer internen Rekrutierungsprozesse. Eine aktive Stellenkampagne inklusive.'
WHERE sku = 'NW-MONTHLY-CAMPAIGN';

INSERT INTO public.talentone_offer_products
  (brand, category, sku, title, description, unit_price, is_default, sort_order, active)
VALUES
  ('nowag_wirth', 'option_monthly', 'NW-OPT-PREQUALIFY',
   'Telefonische Vorqualifizierung der Bewerber',
   'Telefonische Vorqualifizierung aller eingehenden Bewerber durch unser Team, nach Kriterien wie Ausbildung, Wechselmotivation, Erreichbarkeit, Erfahrung und Gehaltsvorstellung. Jedes Gespräch wird dokumentiert und im Bewerber-Hub für Sie hinterlegt. Sie investieren Ihre Zeit nur noch in Kandidaten, die fachlich passen und wirklich wechseln wollen.',
   500.00, true, 55, true)
ON CONFLICT (sku) DO UPDATE
  SET unit_price = EXCLUDED.unit_price,
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      category = EXCLUDED.category,
      is_default = EXCLUDED.is_default,
      sort_order = EXCLUDED.sort_order,
      active = EXCLUDED.active;

UPDATE public.talentone_offer_products
SET category = 'option_setup', is_default = true
WHERE sku = 'NW-SETUP-CREATIVES';
