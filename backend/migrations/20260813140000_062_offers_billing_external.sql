-- Manuelle Kennzeichnung: dieses Angebot wird extern (direkt in easybill)
-- abgerechnet. Stoppt die automatische Monatsabrechnung (Cron) für dieses
-- Angebot, zählt aber weiter im MRR/laufenden Umsatz (Anker = billing_external_at,
-- falls keine tool-seitige Monatsabrechnung aktiviert wurde).
ALTER TABLE talentone_offers
  ADD COLUMN IF NOT EXISTS billing_external_at   timestamptz,
  ADD COLUMN IF NOT EXISTS billing_external_note text,
  ADD COLUMN IF NOT EXISTS billing_external_by   text;
