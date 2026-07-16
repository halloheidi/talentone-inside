
CREATE TABLE IF NOT EXISTS talentone_zahlungen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES talentone_jobs(id) ON DELETE CASCADE,
  kunde_id uuid NOT NULL REFERENCES talentone_kunden(id) ON DELETE CASCADE,
  paypal_invoice_id text,           -- PayPal Invoice-ID (z.B. INV2-XXXX-…)
  paypal_invoice_number text,       -- menschenlesbare Rechnungsnummer
  pay_link text,                    -- Zahlungslink (https://www.paypal.com/invoice/p/…)
  betrag_cent integer NOT NULL,     -- Betrag in Cent (z.B. 150000 = 1.500,00 €)
  waehrung text DEFAULT 'EUR',
  beschreibung text,
  faelligkeit date,
  status text DEFAULT 'offen' CHECK (status IN ('entwurf','offen','bezahlt','ueberfaellig','storniert')),
  gesendet_an text,                 -- E-Mail-Adresse(n), durch Komma getrennt
  gesendet_am timestamptz,
  bezahlt_am timestamptz,
  raw_paypal jsonb,                 -- letzter API-Response für Debugging
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS zahlungen_job_idx ON talentone_zahlungen (job_id);
CREATE INDEX IF NOT EXISTS zahlungen_kunde_idx ON talentone_zahlungen (kunde_id);
CREATE INDEX IF NOT EXISTS zahlungen_status_idx ON talentone_zahlungen (status);
CREATE INDEX IF NOT EXISTS zahlungen_paypal_invoice_idx ON talentone_zahlungen (paypal_invoice_id);
