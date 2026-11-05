-- Änderungsverlauf der Vorqualifizierungs-Felder (Standard + stellenspezifisch).
-- Ein append-only Array je Bewerbung: wer (intern/Kunde) hat welches Feld wann
-- von welchem auf welchen Wert geändert. Wird im Akte-Verlauf (Drawer) angezeigt.
-- Eintrag: { ts, key, feld, von, nach, autor_typ ('intern'|'kunde'), autor }
alter table talentone_bewerber_notizen
  add column if not exists vorqual_verlauf jsonb not null default '[]'::jsonb;
