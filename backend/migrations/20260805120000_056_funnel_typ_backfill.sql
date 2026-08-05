-- Funnel-Variante konsolidieren: funnel_typ für Bestandsdaten backfillen, damit die
-- eine "Funnel-Variante"-Auswahl (Interner Editor | Perspective | Extern) korrekt greift.
-- Kein Datenverlust an extern_url / Konfigurationen.
UPDATE talentone_funnels SET funnel_typ='intern'      WHERE funnel_typ IS NULL AND extern IS NOT TRUE;
UPDATE talentone_funnels SET funnel_typ='perspective' WHERE funnel_typ IS NULL AND extern IS TRUE AND perspective_job_id IS NOT NULL;
UPDATE talentone_funnels SET funnel_typ='onepage'     WHERE funnel_typ IS NULL AND extern IS TRUE;
UPDATE talentone_funnels SET funnel_typ='perspective' WHERE funnel_typ='onepage' AND perspective_job_id IS NOT NULL;
