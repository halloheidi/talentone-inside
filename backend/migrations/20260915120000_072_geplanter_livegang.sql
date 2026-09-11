-- 072: Geplanter Livegang (echtes PLAN-Datum) + Überfällig-Melde-Dedup.
--
-- Befund: start_phase1 trägt faktisch das IST-Startdatum (deckt sich 0–1 Tag mit dem
-- ersten Spend-Tag der Meta-Kampagne; kein einziges Live-Projekt hat start_phase1 in
-- der Zukunft), live_termin ist nie befüllt, startdatum_abo meist null. Es gab also kein
-- echtes Plan-Feld → neues, explizites geplanter_livegang.
alter table talentone_projekte add column if not exists geplanter_livegang date;

-- Dedup für die „überfällig"-Meldung in der täglichen Sammel-Mail: einmal bei Eintritt,
-- danach wöchentlich (nicht täglich). Speichert den Tag der letzten Aufnahme.
alter table talentone_projekte add column if not exists ueberfaellig_gemeldet_am date;
