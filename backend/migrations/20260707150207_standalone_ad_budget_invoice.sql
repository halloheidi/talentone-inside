ALTER TABLE public.talentone_invoices
  ADD COLUMN IF NOT EXISTS source     text NOT NULL DEFAULT 'offer_billing',
  ADD COLUMN IF NOT EXISTS sent_at    timestamptz,
  ADD COLUMN IF NOT EXISTS sent_to    text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_schema = 'public'
      AND constraint_name = 'talentone_invoices_source_check'
  ) THEN
    ALTER TABLE public.talentone_invoices
      ADD CONSTRAINT talentone_invoices_source_check
      CHECK (source IN ('offer_billing', 'standalone'));
  END IF;
END $$;

INSERT INTO public.talentone_offer_templates (brand, key, text) VALUES
  ('talentone', 'invoice_email_subject',
   'Ihre Rechnung von TalentOne — {{period_label}}'),

  ('talentone', 'invoice_email_body',
   E'Hallo {{ansprechpartner}},\n\nanbei erhalten Sie die Rechnung über Ihr Werbebudget für {{period_label}} als PDF-Anhang.\n\nBei Fragen einfach auf diese E-Mail antworten.\n\nHerzliche Grüße\nIhr TalentOne-Team'),

  ('nowag_wirth', 'invoice_email_subject',
   'Ihre Rechnung von Nowag & Wirth — {{period_label}}'),

  ('nowag_wirth', 'invoice_email_body',
   E'Hallo {{ansprechpartner}},\n\nanbei erhalten Sie die Rechnung über Ihr Werbebudget für {{period_label}} als PDF-Anhang.\n\nBei Fragen erreichen Sie mich jederzeit — antworten Sie einfach auf diese E-Mail.\n\nMit besten Grüßen\nIhr Nowag & Wirth-Partnermanager')
ON CONFLICT (brand, key) DO NOTHING;
