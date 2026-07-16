ALTER TABLE public.talentone_invoices
  ADD COLUMN IF NOT EXISTS easybill_invoice_number text;
