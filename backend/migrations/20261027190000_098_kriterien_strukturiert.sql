-- 098 — A4: Kriterien strukturiert. REIN ADDITIV.
--
-- WICHTIG: talentone_jobs.wichtige_kriterien (Array [{kriterium,anforderung,pflicht}])
-- ist fest an die Vorqual-Feld-Invariante gebunden (kriterien.js: jedes Kriterium
-- referenziert genau ein Vorqual-Feld; Kunden-Spaltenlogik). Diese Spalte wird daher
-- NICHT verändert. Die neue, strukturierte Form lebt in EIGENER Spalte
-- talentone_jobs.wichtige_kriterien_struktur:
--   { ko:[{id,text,aktiv}], muss:[...], wunsch:[...], hinweis_freitext,
--     zuletzt_geaendert_von:'nw'|'kunde', zuletzt_geaendert_am }
-- Seed aus dem Alt-Array (pflicht=true → muss, sonst wunsch; KO initial leer;
-- Text = kriterium — anforderung). Alt-Array zusätzlich als Backup gesichert.

ALTER TABLE talentone_jobs ADD COLUMN IF NOT EXISTS wichtige_kriterien_struktur jsonb;
ALTER TABLE talentone_jobs ADD COLUMN IF NOT EXISTS wichtige_kriterien_legacy   jsonb;  -- Backup der Alt-Form
ALTER TABLE talentone_bewerber_notizen ADD COLUMN IF NOT EXISTS kriterien_check jsonb;   -- {<kriterium_id>: true|false|null}

CREATE TABLE IF NOT EXISTS talentone_kriterien_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id     uuid NOT NULL REFERENCES talentone_jobs(id) ON DELETE CASCADE,
  von        text NOT NULL,          -- 'nw' | 'kunde'
  diff       jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kriterien_log_job ON talentone_kriterien_log (job_id, created_at);

-- Alt-Array sichern (idempotent).
UPDATE talentone_jobs
   SET wichtige_kriterien_legacy = wichtige_kriterien
 WHERE jsonb_typeof(wichtige_kriterien) = 'array'
   AND wichtige_kriterien_legacy IS NULL;

-- Strukturierte Form aus dem Alt-Array ableiten (wichtige_kriterien bleibt unberührt).
UPDATE talentone_jobs j
   SET wichtige_kriterien_struktur = jsonb_build_object(
     'ko', '[]'::jsonb,
     'muss', COALESCE((
       SELECT jsonb_agg(jsonb_build_object(
         'id', gen_random_uuid()::text,
         'text', NULLIF(trim(concat_ws(' — ', NULLIF(e->>'kriterium',''), NULLIF(e->>'anforderung',''))), ''),
         'aktiv', true))
       FROM jsonb_array_elements(j.wichtige_kriterien) e
       WHERE (e->>'pflicht')::boolean IS TRUE
         AND NULLIF(trim(concat_ws(' — ', NULLIF(e->>'kriterium',''), NULLIF(e->>'anforderung',''))), '') IS NOT NULL
     ), '[]'::jsonb),
     'wunsch', COALESCE((
       SELECT jsonb_agg(jsonb_build_object(
         'id', gen_random_uuid()::text,
         'text', NULLIF(trim(concat_ws(' — ', NULLIF(e->>'kriterium',''), NULLIF(e->>'anforderung',''))), ''),
         'aktiv', true))
       FROM jsonb_array_elements(j.wichtige_kriterien) e
       WHERE (e->>'pflicht')::boolean IS NOT TRUE
         AND NULLIF(trim(concat_ws(' — ', NULLIF(e->>'kriterium',''), NULLIF(e->>'anforderung',''))), '') IS NOT NULL
     ), '[]'::jsonb),
     'hinweis_freitext', '',
     'zuletzt_geaendert_von', 'nw',
     'zuletzt_geaendert_am', now()::text
   )
 WHERE jsonb_typeof(j.wichtige_kriterien) = 'array'
   AND j.wichtige_kriterien_struktur IS NULL;
