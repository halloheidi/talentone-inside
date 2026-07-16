CREATE TABLE IF NOT EXISTS public.talentone_invoices (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id               uuid REFERENCES public.talentone_offers(id) ON DELETE SET NULL,
  customer_id            uuid REFERENCES public.talentone_kunden(id) ON DELETE SET NULL,
  easybill_customer_id   text NOT NULL,
  brand                  text NOT NULL CHECK (brand IN ('talentone','nowag_wirth')),
  invoice_type           text NOT NULL CHECK (invoice_type IN ('setup','monthly_service','ad_budget','monthly_combined')),
  period_start           date,
  period_end             date,
  amount_net             numeric(12,2) NOT NULL DEFAULT 0,
  vat_rate               numeric(5,2)  NOT NULL DEFAULT 19,
  amount_gross           numeric(12,2) NOT NULL DEFAULT 0,
  payment_method         text NOT NULL DEFAULT 'bank_transfer' CHECK (payment_method IN ('bank_transfer','paypal')),
  easybill_document_id   text UNIQUE,
  easybill_pdf_url       text,
  status                 text NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft','sent','paid','partially_paid','overdue','cancelled')),
  due_date               date,
  paid_at                timestamptz,
  paypal_pay_link        text,
  paypal_reference       text,
  last_synced_at         timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.talentone_invoices IS
  'Rechnungen aus dem Angebots-System — Setup (einmalig) und monatliche (aus easybill-RECURRING oder eigenem Cron). Der Zahlungs-Rücksync läuft über /document-payments in easybill.';

CREATE INDEX IF NOT EXISTS talentone_invoices_offer_idx    ON public.talentone_invoices (offer_id);
CREATE INDEX IF NOT EXISTS talentone_invoices_customer_idx ON public.talentone_invoices (customer_id);
CREATE INDEX IF NOT EXISTS talentone_invoices_status_idx   ON public.talentone_invoices (status);
CREATE INDEX IF NOT EXISTS talentone_invoices_easybill_idx ON public.talentone_invoices (easybill_document_id);

ALTER TABLE public.talentone_invoices ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_talentone_invoices_upd ON public.talentone_invoices;
CREATE TRIGGER trg_talentone_invoices_upd
  BEFORE UPDATE ON public.talentone_invoices
  FOR EACH ROW EXECUTE FUNCTION public.talentone_touch_updated_at();

ALTER TABLE public.talentone_offers
  ADD COLUMN IF NOT EXISTS easybill_recurring_document_id text,
  ADD COLUMN IF NOT EXISTS billing_ended_at              timestamptz;

ALTER TABLE public.talentone_kunden
  ADD COLUMN IF NOT EXISTS campaign_payment_status text NOT NULL DEFAULT 'ok'
    CHECK (campaign_payment_status IN ('ok','pending','blocked')),
  ADD COLUMN IF NOT EXISTS paypal_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.talentone_ad_budget_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id     uuid NOT NULL REFERENCES public.talentone_offers(id) ON DELETE CASCADE,
  old_amount   numeric(12,2),
  new_amount   numeric(12,2) NOT NULL,
  effective_from date,
  changed_by   text,
  reason       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.talentone_ad_budget_history IS
  'Historie der Werbebudget-Änderungen am aktiven monatlichen Abo eines Angebots.';
CREATE INDEX IF NOT EXISTS talentone_ad_budget_history_offer_idx
  ON public.talentone_ad_budget_history (offer_id, created_at DESC);
ALTER TABLE public.talentone_ad_budget_history ENABLE ROW LEVEL SECURITY;
