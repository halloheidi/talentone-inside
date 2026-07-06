-- Migration 003: Lokaler Cache der easybill-Kundenliste.
--
-- easybill ist die führende Kundenquelle für Angebote/Rechnungen. Statt bei
-- jedem Tastendruck gegen die easybill-API zu suchen (langsam, Rate-Limits),
-- pflegen wir hier einen lokalen Spiegel und syncen ihn stündlich per Cron.
-- On-demand-Sync-Trigger ("Liste aktualisieren") ergänzt den Cron.

CREATE TABLE IF NOT EXISTS public.talentone_easybill_customers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  easybill_id         bigint NOT NULL UNIQUE,
  number              text,
  company_name        text,
  first_name          text,
  last_name           text,
  email               text,             -- emails[0] für Suche/Anzeige
  emails              jsonb NOT NULL DEFAULT '[]'::jsonb,
  street              text,
  zip_code            text,
  city                text,
  country             text,
  phone_1             text,
  phone_2             text,
  vat_identifier      text,
  raw                 jsonb NOT NULL DEFAULT '{}'::jsonb,  -- vollständiges Customer-Objekt aus easybill
  easybill_created_at timestamptz,
  easybill_updated_at timestamptz,
  synced_at           timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.talentone_easybill_customers IS
  'Stündlich gesyncter Cache der easybill-Kundenliste. Backend liest hier für die Wizard-Suche; Schreibvorgänge gehen zuerst nach easybill (führende Quelle) und werden dann im Cache upsert.';

CREATE INDEX IF NOT EXISTS talentone_easybill_customers_company_idx
  ON public.talentone_easybill_customers (lower(company_name));
CREATE INDEX IF NOT EXISTS talentone_easybill_customers_number_idx
  ON public.talentone_easybill_customers (number);
CREATE INDEX IF NOT EXISTS talentone_easybill_customers_email_idx
  ON public.talentone_easybill_customers (lower(email));

-- Trigram-Index für fuzzy-search (ähnliche Firmennamen bei Dubletten-Check)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS talentone_easybill_customers_company_trgm_idx
  ON public.talentone_easybill_customers
  USING gin (lower(company_name) gin_trgm_ops);

ALTER TABLE public.talentone_easybill_customers ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_talentone_easybill_customers_upd
  ON public.talentone_easybill_customers;
CREATE TRIGGER trg_talentone_easybill_customers_upd
  BEFORE UPDATE ON public.talentone_easybill_customers
  FOR EACH ROW EXECUTE FUNCTION public.talentone_touch_updated_at();
