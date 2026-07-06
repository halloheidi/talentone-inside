-- Migration 004: guarantee_label als eigener Textbaustein je Marke.
-- TalentOne bewirbt "Bewerbungsgarantie", N&W nutzt "Erfolgsgarantie" —
-- die Überschrift über dem Garantie-Block darf nicht im Code hartkodiert
-- sein. Der Builder liest bevorzugt diesen Key; fällt zurück auf
-- eingebaute Defaults, falls die Row fehlt.

INSERT INTO public.talentone_offer_templates (brand, key, text) VALUES
  ('talentone',   'guarantee_label', 'Bewerbungsgarantie'),
  ('nowag_wirth', 'guarantee_label', 'Erfolgsgarantie')
ON CONFLICT (brand, key) DO NOTHING;
