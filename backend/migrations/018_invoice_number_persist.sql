-- Migration 018: Finale easybill-Rechnungsnummer persistieren.
--
-- easybill vergibt die Rechnungsnummer erst mit der Finalisierung
-- (PUT /documents/{id}/done). Ab jetzt speichern wir sie in
-- talentone_invoices, damit wir sie a) an Kunden ausweisen, b) im
-- Bestandsaufnahmen-Script schnell prüfen können, ob eine Rechnung
-- finalisiert ist (leerer Wert = Draft).

ALTER TABLE public.talentone_invoices
  ADD COLUMN IF NOT EXISTS easybill_invoice_number text;
