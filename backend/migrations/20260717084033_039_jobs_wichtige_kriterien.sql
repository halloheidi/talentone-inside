ALTER TABLE talentone_jobs
  ADD COLUMN IF NOT EXISTS wichtige_kriterien jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN talentone_jobs.wichtige_kriterien IS
  'Worauf achten wir bei der Vorqualifizierung? Liste: [{kriterium, anforderung, pflicht}]. '
  'Pflicht-Kriterien werden dem Telefonisten mit ❗ angezeigt. Die hier genannten Kriterien '
  'sind in der Kunden-Ansicht IMMER als Spalte sichtbar (auch leer), damit der Kunde sieht, '
  'dass genau diese Punkte systematisch geprueft werden. Vom Kunden im Portal editierbar.';
