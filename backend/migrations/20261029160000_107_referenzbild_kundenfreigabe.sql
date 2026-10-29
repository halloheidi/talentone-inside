-- Foto-Durchsicht durch den Kunden (Daten-Prüfungs-Flow):
-- pro Referenzbild eine Kunden-Freigabe. NULL = ungeprüft (weiter nutzbar).
-- 'ja' = weiter verwenden · 'nein' = gesperrt (wird nie an KI-Generierung übergeben
-- und in den Bild-Pickern ausgeblendet) · 'unsicher' = weiter nutzbar, zur Klärung.
ALTER TABLE talentone_referenzbilder
  ADD COLUMN IF NOT EXISTS kunde_freigabe text,
  ADD COLUMN IF NOT EXISTS kunde_kommentar text,
  ADD COLUMN IF NOT EXISTS kunde_geprueft_am timestamptz;

ALTER TABLE talentone_referenzbilder
  DROP CONSTRAINT IF EXISTS talentone_referenzbilder_kunde_freigabe_chk;
ALTER TABLE talentone_referenzbilder
  ADD CONSTRAINT talentone_referenzbilder_kunde_freigabe_chk
  CHECK (kunde_freigabe IS NULL OR kunde_freigabe IN ('ja','nein','unsicher'));
