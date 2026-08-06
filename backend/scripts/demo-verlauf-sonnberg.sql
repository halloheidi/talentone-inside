-- EINMAL-SKRIPT (kein Migration): Demo-Verlauf für den DEMO-Kunden
-- „Elektrotechnik Sonnberg GmbH", Projekt „Mitarbeitergewinnung Elektroniker".
--
-- Schreibt NUR Daten (keine E-Mails) über exakt die Strukturen, aus denen der
-- „Freigabe & Go-Live"-Tab seinen Verlauf zusammensetzt (backend/aktivitaet.js:
-- talentone_versand + talentone_reviews + talentone_funnels). Keine Sonderlogik.
--
-- Idempotent: löscht vorab die Verlauf-Zeilen dieses (reinen Demo-)Jobs und legt
-- sie neu an. Datumsangaben passend zu „Live seit 22.7." (heute ~06.08.2026).

DO $$
DECLARE
  demo_job   uuid := 'c62d7e57-913f-4a38-8b83-088835caeca8';
  demo_email text := 'demo@sonnberg-elektro.example.de';
BEGIN
  DELETE FROM talentone_versand WHERE job_id = demo_job;
  DELETE FROM talentone_reviews WHERE job_id = demo_job;
  DELETE FROM talentone_funnels WHERE job_id = demo_job;

  -- 1) Funnel gebaut (~18 Tage) → 19.07.
  INSERT INTO talentone_funnels (job_id, created_at, fragen)
  VALUES (demo_job, '2026-07-19T10:00:00+02', '[]'::jsonb);

  -- 2) Entwürfe verschickt (Runde 1) (~17 Tage) → 20.07.
  INSERT INTO talentone_versand (job_id, empfaenger, betreff, typ, gesendet_von, inhalte, created_at)
  VALUES (demo_job, demo_email, 'Deine Entwürfe sind fertig 🎨', 'entwurf_runde_1', 'demo-seed',
          '{"runde":1,"variante":"erstversand"}'::jsonb, '2026-07-20T09:00:00+02');

  -- 3) Kunde hat geantwortet (Runde 1) mit Feedback (~16 Tage) → 21.07.
  --    status='aenderungen' + kommentare.general → „Kundenfeedback: Änderungswünsche".
  INSERT INTO talentone_reviews (job_id, token, status, runde, kontext, kommentare, kommentare_snapshot, created_at, updated_at)
  VALUES (demo_job, gen_random_uuid()::text, 'aenderungen', 1, 'entwurf',
          '{"general":"Sehen stark aus! Zwei Wünsche: Bitte den Firmenwagen prominenter auf die Bilder und beim zweiten Motiv ein anderes Foto verwenden."}'::jsonb,
          '{}'::jsonb,
          '2026-07-20T09:05:00+02', '2026-07-21T14:00:00+02');

  -- 4) Entwürfe verschickt (Runde 2) (~15 Tage) → 22.07.
  INSERT INTO talentone_versand (job_id, empfaenger, betreff, typ, gesendet_von, inhalte, created_at)
  VALUES (demo_job, demo_email, 'Deine überarbeiteten Entwürfe sind fertig 🎨', 'entwurf_runde_2', 'demo-seed',
          '{"runde":2,"variante":"neue_runde"}'::jsonb, '2026-07-22T09:00:00+02');

  -- 5) Entwürfe freigegeben (Runde 2) (~14 Tage) → 23.07.
  INSERT INTO talentone_reviews (job_id, token, status, runde, kontext, kommentare, kommentare_snapshot, created_at, updated_at)
  VALUES (demo_job, gen_random_uuid()::text, 'freigegeben', 2, 'entwurf',
          '{"general":"Perfekt jetzt — so können die live gehen. Danke!"}'::jsonb,
          '{}'::jsonb,
          '2026-07-22T09:05:00+02', '2026-07-23T09:00:00+02');

  -- 6) Kampagne als Live gemeldet (~14 Tage) → 23.07. (konsistent mit Live seit 22.7.)
  INSERT INTO talentone_versand (job_id, empfaenger, betreff, typ, gesendet_von, created_at)
  VALUES (demo_job, demo_email, '🚀 Deine Kampagne ist live!', 'kampagne_live', 'demo-seed', '2026-07-23T13:00:00+02');
END $$;
