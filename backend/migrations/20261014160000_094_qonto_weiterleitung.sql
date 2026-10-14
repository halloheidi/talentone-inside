-- 094 — Qonto-Rechnungsweiterleitung: Verarbeitungs-Log (Dedupe) + gelernte Absender-Regeln.
CREATE TABLE IF NOT EXISTS talentone_qonto_weiterleitungen (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id        text NOT NULL,
  konto             text NOT NULL,              -- Postfach, in dem die Mail lag
  absender          text,
  betreff           text,
  empfaenger_erkannt text NOT NULL,             -- 'nowagwirth' | 'halloheidi' | 'manuell'
  weitergeleitet_an text,                       -- Qonto-Adresse (null wenn manuell/dry)
  status            text NOT NULL DEFAULT 'erkannt', -- erkannt | weitergeleitet | manuell | fehler | mahnung
  erkannt_via       text,                       -- name|ustid|adresse|domain_schwach|absender_regel|mehrdeutig|keiner|mahnung
  pdf_namen         jsonb DEFAULT '[]'::jsonb,
  hinweis           text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, konto, empfaenger_erkannt)
);
CREATE INDEX IF NOT EXISTS idx_qonto_wl_status ON talentone_qonto_weiterleitungen (status, created_at DESC);

CREATE TABLE IF NOT EXISTS talentone_qonto_absender_regeln (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  absender    text NOT NULL UNIQUE,             -- Absender-E-Mail oder Domain
  firma       text NOT NULL CHECK (firma IN ('nowagwirth', 'halloheidi')),
  erstellt_von text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
