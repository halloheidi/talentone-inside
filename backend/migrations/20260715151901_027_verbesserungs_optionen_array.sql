-- Mehrere Optionen pro verbesserter Version (Multi-Select). Alte single-Spalte bleibt fuer Backwards-Compat,
-- wird aber nicht mehr geschrieben.
ALTER TABLE talentone_referenzbilder
  ADD COLUMN IF NOT EXISTS verbesserungs_optionen text[];
COMMENT ON COLUMN talentone_referenzbilder.verbesserungs_optionen IS
  'Angewendete Verbesserungs-Optionen als Array: qualitaet, hg_aufraeumen, hg_ersetzen, ausschnitt.';
