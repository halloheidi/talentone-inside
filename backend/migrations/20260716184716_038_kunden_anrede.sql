ALTER TABLE talentone_kunden
  ADD COLUMN IF NOT EXISTS anrede_form  TEXT,
  ADD COLUMN IF NOT EXISTS anrede_titel TEXT,
  ADD COLUMN IF NOT EXISTS nachname     TEXT;

ALTER TABLE talentone_kunden
  DROP CONSTRAINT IF EXISTS talentone_kunden_anrede_form_chk;
ALTER TABLE talentone_kunden
  ADD CONSTRAINT talentone_kunden_anrede_form_chk
  CHECK (anrede_form IS NULL OR anrede_form IN ('du','sie'));

ALTER TABLE talentone_kunden
  DROP CONSTRAINT IF EXISTS talentone_kunden_anrede_titel_chk;
ALTER TABLE talentone_kunden
  ADD CONSTRAINT talentone_kunden_anrede_titel_chk
  CHECK (anrede_titel IS NULL OR anrede_titel IN ('herr','frau'));

COMMENT ON COLUMN talentone_kunden.anrede_form  IS 'Wie sprechen wir den Kunden an: du | sie. NULL = noch nicht festgelegt -> wird beim naechsten Versand einmalig abgefragt. Bewusst KEIN Default (kein Massen-Default fuer Bestandskunden).';
COMMENT ON COLUMN talentone_kunden.anrede_titel IS 'Nur bei anrede_form=sie: herr | frau. Ergibt "Hallo Herr Junk" / "Hallo Frau Junk".';
COMMENT ON COLUMN talentone_kunden.nachname     IS 'Nachname des Ansprechpartners fuer die Sie-Anrede. Wird beim Setzen der Anrede aus ansprechpartner vorgeschlagen, ist aber separat editierbar (Doppelnamen, Titel etc.).';
