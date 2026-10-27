-- 097 — A3: Vertragsmodell je Projekt (talentone_projekte). REIN ADDITIV.
-- Alte Felder (projektdauer, startdatum_abo, enddatum_abo, pausiert_seit) bleiben
-- bestehen und werden NICHT gelöscht; die neuen Felder sind der maßgebliche Nachfolger.
--
-- Best-effort-Migration aus projektdauer (DISTINCT geprüft, alle parsebar):
--   '30 Tage'/'60 Tage'/'90 Tage' -> wert N, einheit 'tage', Modell 'kampagne'
--   '6 Monate'                    -> wert 6, einheit 'monate', Modell 'abo' (Monate = Abo)
--   'abo'/'Abo'                   -> Modell 'abo', wert/einheit NULL (offene Laufzeit)
-- Abo zusätzlich, wenn startdatum_abo/enddatum_abo gesetzt. pausiert_seit -> ein
-- offener Pausen-Eintrag. Nicht parsebare projektdauer-Werte: KEINE (Bericht).

ALTER TABLE talentone_projekte ADD COLUMN IF NOT EXISTS vertragsmodell  text CHECK (vertragsmodell IN ('kampagne','abo'));
ALTER TABLE talentone_projekte ADD COLUMN IF NOT EXISTS laufzeit_wert   integer;
ALTER TABLE talentone_projekte ADD COLUMN IF NOT EXISTS laufzeit_einheit text CHECK (laufzeit_einheit IN ('tage','monate'));
ALTER TABLE talentone_projekte ADD COLUMN IF NOT EXISTS start_datum     date;
ALTER TABLE talentone_projekte ADD COLUMN IF NOT EXISTS pausen          jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Laufzeit-Wert/-Einheit aus projektdauer-Text.
UPDATE talentone_projekte
   SET laufzeit_wert = NULLIF(substring(projektdauer from '(\d+)'), '')::int
 WHERE projektdauer IS NOT NULL AND laufzeit_wert IS NULL;

UPDATE talentone_projekte
   SET laufzeit_einheit = CASE
         WHEN projektdauer ~* 'monat' THEN 'monate'
         WHEN projektdauer ~* 'tag'   THEN 'tage'
         ELSE NULL END
 WHERE projektdauer IS NOT NULL AND laufzeit_einheit IS NULL;

-- Vertragsmodell: Abo bei 'abo'-Wortteil, Abo-Datumsfeldern oder Monats-Einheit, sonst Kampagne.
UPDATE talentone_projekte
   SET vertragsmodell = CASE
         WHEN projektdauer ~* 'abo' OR startdatum_abo IS NOT NULL OR enddatum_abo IS NOT NULL
              OR projektdauer ~* 'monat' THEN 'abo'
         WHEN projektdauer IS NOT NULL THEN 'kampagne'
         ELSE NULL END
 WHERE vertragsmodell IS NULL
   AND (projektdauer IS NOT NULL OR startdatum_abo IS NOT NULL OR enddatum_abo IS NOT NULL);

-- Start-Datum: Abo-Start bevorzugt, sonst Phase-1-Start.
UPDATE talentone_projekte
   SET start_datum = COALESCE(startdatum_abo, start_phase1)
 WHERE start_datum IS NULL
   AND COALESCE(startdatum_abo, start_phase1) IS NOT NULL;

-- pausiert_seit -> ein offener Pausen-Eintrag (quelle nw, beantragt/bestätigt = pausiert_seit).
UPDATE talentone_projekte
   SET pausen = jsonb_build_array(jsonb_build_object(
         'von', pausiert_seit::text,
         'bis', NULL,
         'grund', 'Aus pausiert_seit migriert',
         'quelle', 'nw',
         'beantragt_am', pausiert_seit::text,
         'bestaetigt_am', pausiert_seit::text
       ))
 WHERE pausiert_seit IS NOT NULL
   AND (pausen IS NULL OR pausen = '[]'::jsonb);
