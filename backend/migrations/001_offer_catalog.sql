-- Migration 001: Angebots-Katalog + Angebote + Textbausteine
-- Phase 1 des Angebots-/Abrechnungs-/Controlling-Systems.
--
-- Enums werden als TEXT mit CHECK-Constraints modelliert (konsistent
-- mit bestehenden talentone_*-Tabellen). RLS aktiviert; Zugriff läuft
-- ausschließlich über Backend mit service_role_key.

-- ─────────── talentone_offer_products (Positionskatalog) ───────────
CREATE TABLE IF NOT EXISTS public.talentone_offer_products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand         text NOT NULL CHECK (brand IN ('talentone', 'nowag_wirth')),
  category      text NOT NULL CHECK (category IN ('setup', 'monthly', 'option_setup', 'option_monthly')),
  sku           text NOT NULL UNIQUE,
  title         text NOT NULL,
  description   text NOT NULL DEFAULT '',
  unit_price    numeric(12,2) NOT NULL DEFAULT 0,
  is_default    boolean NOT NULL DEFAULT false,
  sort_order    integer NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.talentone_offer_products IS
  'Positionskatalog für Angebote — pro Marke (talentone|nowag_wirth) und Kategorie (setup|monthly|option_setup|option_monthly). Preise/Texte editierbar via Admin-UI.';

CREATE INDEX IF NOT EXISTS talentone_offer_products_brand_cat_idx
  ON public.talentone_offer_products (brand, category, sort_order);

ALTER TABLE public.talentone_offer_products ENABLE ROW LEVEL SECURITY;

-- ─────────── talentone_offer_templates (markenabhängige Textbausteine) ───────────
CREATE TABLE IF NOT EXISTS public.talentone_offer_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand       text NOT NULL CHECK (brand IN ('talentone', 'nowag_wirth')),
  key         text NOT NULL,
  text        text NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand, key)
);
COMMENT ON TABLE public.talentone_offer_templates IS
  'Markenabhängige Textbausteine (guarantee, payment_terms, reminder_email, ...) für Angebote und E-Mails.';

ALTER TABLE public.talentone_offer_templates ENABLE ROW LEVEL SECURITY;

-- ─────────── talentone_offers (erzeugte Angebote) ───────────
CREATE TABLE IF NOT EXISTS public.talentone_offers (
  id                             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand                          text NOT NULL CHECK (brand IN ('talentone', 'nowag_wirth')),
  customer_id                    uuid REFERENCES public.talentone_kunden(id) ON DELETE SET NULL,
  easybill_customer_id           text NOT NULL,
  customer_snapshot              jsonb NOT NULL DEFAULT '{}'::jsonb,
  close_lead_id                  text,
  selected_product_ids           jsonb NOT NULL DEFAULT '[]'::jsonb,
  ad_budget_monthly              numeric(12,2),
  additional_positions_count     integer NOT NULL DEFAULT 0,
  setup_total                    numeric(12,2) NOT NULL DEFAULT 0,
  monthly_total                  numeric(12,2) NOT NULL DEFAULT 0,
  first_month_total              numeric(12,2) NOT NULL DEFAULT 0,
  vat_rate                       numeric(5,2) NOT NULL DEFAULT 19,
  status                         text NOT NULL DEFAULT 'draft'
                                   CHECK (status IN ('draft','created','sent','accepted','declined')),
  easybill_document_id           text,
  easybill_order_document_id     text,
  easybill_pdf_url               text,
  accepted_at                    timestamptz,
  last_synced_at                 timestamptz,
  created_by                     text,
  created_at                     timestamptz NOT NULL DEFAULT now(),
  updated_at                     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.talentone_offers IS
  'Erzeugte Angebote. selected_product_ids: Array von {product_id, quantity}. easybill_customer_id ist Pflicht (easybill ist führende Kundenquelle).';

CREATE INDEX IF NOT EXISTS talentone_offers_customer_idx     ON public.talentone_offers (customer_id);
CREATE INDEX IF NOT EXISTS talentone_offers_easybill_cust_idx ON public.talentone_offers (easybill_customer_id);
CREATE INDEX IF NOT EXISTS talentone_offers_status_idx        ON public.talentone_offers (status);
CREATE INDEX IF NOT EXISTS talentone_offers_easybill_doc_idx  ON public.talentone_offers (easybill_document_id);

ALTER TABLE public.talentone_offers ENABLE ROW LEVEL SECURITY;

-- ─────────── Auto-Update Trigger für updated_at ───────────
CREATE OR REPLACE FUNCTION public.talentone_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_talentone_offer_products_upd ON public.talentone_offer_products;
CREATE TRIGGER trg_talentone_offer_products_upd
  BEFORE UPDATE ON public.talentone_offer_products
  FOR EACH ROW EXECUTE FUNCTION public.talentone_touch_updated_at();

DROP TRIGGER IF EXISTS trg_talentone_offer_templates_upd ON public.talentone_offer_templates;
CREATE TRIGGER trg_talentone_offer_templates_upd
  BEFORE UPDATE ON public.talentone_offer_templates
  FOR EACH ROW EXECUTE FUNCTION public.talentone_touch_updated_at();

DROP TRIGGER IF EXISTS trg_talentone_offers_upd ON public.talentone_offers;
CREATE TRIGGER trg_talentone_offers_upd
  BEFORE UPDATE ON public.talentone_offers
  FOR EACH ROW EXECUTE FUNCTION public.talentone_touch_updated_at();
