ALTER TABLE talentone_projekte
  ADD COLUMN IF NOT EXISTS kickoff_termin DATE;

COMMENT ON COLUMN talentone_projekte.kickoff_termin IS
  'Vereinbarter Kick-Off-Termin mit dem Kunden. Sichtbar im Slide-Over und als Chip auf der Kanban-Karte. NULL wenn noch nicht terminiert.';
