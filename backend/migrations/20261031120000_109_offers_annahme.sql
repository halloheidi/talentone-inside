-- 109 — Angebots-Versand + öffentliche Annahme-Seite.
-- Rein additiv. Nutzt bestehende Spalten weiter: accepted_at (= angenommen_am),
-- sent_at/sent_to (Versand), status (draft/created/sent/accepted/declined),
-- gueltig_bis (Token-Ablauf). Neu: öffentlicher Annahme-Token + Annahme-Metadaten,
-- Öffnungs-/Rückfrage-Marker, gewählter Absender.

ALTER TABLE talentone_offers
  ADD COLUMN IF NOT EXISTS annahme_token text,
  ADD COLUMN IF NOT EXISTS angenommen_von text,          -- Name des Annehmenden
  ADD COLUMN IF NOT EXISTS angenommen_funktion text,     -- Funktion/Rolle
  ADD COLUMN IF NOT EXISTS angenommen_ip text,
  ADD COLUMN IF NOT EXISTS angenommene_optionen jsonb,   -- angekreuzte optionale Positionen (Snapshot)
  ADD COLUMN IF NOT EXISTS geoeffnet_am timestamptz,     -- erster Aufruf der Annahme-Seite
  ADD COLUMN IF NOT EXISTS rueckfrage_am timestamptz,
  ADD COLUMN IF NOT EXISTS rueckfrage_text text,
  ADD COLUMN IF NOT EXISTS absender text;                -- 'johannes' | 'daniel' (Versand-Absender)

-- Token eindeutig (partieller Unique-Index, NULL erlaubt mehrfach).
CREATE UNIQUE INDEX IF NOT EXISTS talentone_offers_annahme_token_uidx
  ON talentone_offers (annahme_token) WHERE annahme_token IS NOT NULL;
