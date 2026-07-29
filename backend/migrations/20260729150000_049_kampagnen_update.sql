-- Kampagnen-Update: getrennte Review-Ströme + Live-Sub-Status.
--
-- 1) Getrennte Runden-Zählung: Unique jetzt über (job_id, kontext, runde), damit
--    Entwurfs- und Update-Runden unabhängig hochzählen ("Runde N" vs "Update N").
DROP INDEX IF EXISTS talentone_reviews_job_runde_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS talentone_reviews_job_kontext_runde_uniq
  ON talentone_reviews (job_id, kontext, runde);

-- 2) Sub-Status für offenes Update-Feedback während der Live-Phase. Der Basis-Status
--    des Projekts bleibt 'live'; dieser Zusatz steuert Badge/Reminder/Nächster-Schritt.
--    null = kein offenes Update-Feedback; 'offen' = Update verschickt, Kunde muss freigeben;
--    'ueberarbeitung' = Kunde hat Änderungswünsche zum Update geäußert.
ALTER TABLE talentone_projekte ADD COLUMN IF NOT EXISTS update_feedback_status text;
ALTER TABLE talentone_projekte ADD COLUMN IF NOT EXISTS update_feedback_seit timestamptz;
