-- Für die 7-Tage-Erinnerung: internes Reminder-Flag am Review
ALTER TABLE talentone_reviews
  ADD COLUMN IF NOT EXISTS reminder_intern_gesendet_at TIMESTAMPTZ;

COMMENT ON COLUMN talentone_reviews.reminder_intern_gesendet_at IS
  'Zeitstempel der internen 7-Tage-Erinnerung. NULL solange nicht gesendet. Nach Reset (neue Runde) wieder NULL.';

-- Für "Kunde hat manuell geantwortet"
ALTER TABLE talentone_reviews
  ADD COLUMN IF NOT EXISTS manuell_beantwortet BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS manuell_notiz       TEXT;

COMMENT ON COLUMN talentone_reviews.manuell_beantwortet IS
  'True wenn der Kunde nicht ueber die Review-Seite, sondern telefonisch/per Mail geantwortet hat. Der Status/kommentare-Bereich wurde vom Team gesetzt.';
COMMENT ON COLUMN talentone_reviews.manuell_notiz IS
  'Optionale Freitext-Notiz: was hat der Kunde telefonisch/per Mail gesagt?';
