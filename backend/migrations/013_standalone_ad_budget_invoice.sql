-- Migration 013: Freistehende Werbekosten-Rechnung (ohne Angebots-Bezug).
--
-- Änderungen an talentone_invoices:
--   - source-Spalte (enum 'offer_billing' | 'standalone', default 'offer_billing')
--     — trennt Standalone-Rechnungen sauber von den Abo-Rechnungen; existierende
--     Rows werden als 'offer_billing' markiert.
--   - sent_at / sent_to — Protokollierung des optionalen Rechnungs-Mail-Versands
--     (analog zum Angebots-/AB-Mail-Log).
--
-- Neue Templates: invoice_email_subject / invoice_email_body je Marke —
--   knapper Zweizeiler, weil die Rechnung selbstsprechend im Anhang liegt.

ALTER TABLE public.talentone_invoices
  ADD COLUMN IF NOT EXISTS source     text NOT NULL DEFAULT 'offer_billing',
  ADD COLUMN IF NOT EXISTS label      text,        -- Freitext-Bezeichnung (z. B. "Juli 2026", "Kampagne Servicetechniker")
  ADD COLUMN IF NOT EXISTS sent_at    timestamptz,
  ADD COLUMN IF NOT EXISTS sent_to    text;

-- Constraint zentrale einmalige Ergänzung (idempotent-safe)
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
