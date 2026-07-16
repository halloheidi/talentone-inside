CREATE TABLE IF NOT EXISTS public.talentone_brand_assets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand         text NOT NULL CHECK (brand IN ('talentone', 'nowag_wirth')),
  asset_key     text NOT NULL,
  filename      text NOT NULL,
  size_bytes    integer NOT NULL,
  storage_path  text NOT NULL,
  uploaded_by   text,
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand, asset_key)
);
COMMENT ON TABLE public.talentone_brand_assets IS
  'Marken-spezifische Anhänge (Flyer, Übersichten) für Angebots-Mails.';
CREATE INDEX IF NOT EXISTS talentone_brand_assets_brand_key_idx
  ON public.talentone_brand_assets (brand, asset_key);
ALTER TABLE public.talentone_brand_assets ENABLE ROW LEVEL SECURITY;

INSERT INTO public.talentone_offer_templates (brand, key, text) VALUES
  ('talentone', 'offer_email_flyer_paragraph',
   'Anbei finden Sie außerdem unsere Kurzübersicht mit allen Leistungen und Abläufen auf einen Blick.'),
  ('nowag_wirth', 'offer_email_flyer_paragraph',
   'Im Anhang finden Sie zusätzlich unsere Übersicht zur Zusammenarbeit mit Nowag & Wirth — mit allen Leistungen und dem Ablauf Ihrer Kampagne auf einen Blick.')
ON CONFLICT (brand, key) DO NOTHING;
