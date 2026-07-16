
ALTER TABLE talentone_zahlungen
  ADD COLUMN IF NOT EXISTS betrag_netto integer,
  ADD COLUMN IF NOT EXISTS betrag_mwst integer,
  ADD COLUMN IF NOT EXISTS betrag_brutto integer,
  ADD COLUMN IF NOT EXISTS leistungszeitraum text,
  ADD COLUMN IF NOT EXISTS kleinunternehmer boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS easybill_id text,
  ADD COLUMN IF NOT EXISTS easybill_status text,
  ADD COLUMN IF NOT EXISTS easybill_invoice_number text;

-- Bestehende Zahlungen migrieren: betrag_cent = brutto annehmen, netto = brutto/1.19
UPDATE talentone_zahlungen
SET betrag_brutto = betrag_cent,
    betrag_netto  = ROUND(betrag_cent / 1.19)::int,
    betrag_mwst   = betrag_cent - ROUND(betrag_cent / 1.19)::int
WHERE betrag_brutto IS NULL AND betrag_cent IS NOT NULL;

CREATE INDEX IF NOT EXISTS zahlungen_easybill_id_idx ON talentone_zahlungen (easybill_id);
