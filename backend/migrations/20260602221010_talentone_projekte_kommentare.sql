
CREATE TABLE IF NOT EXISTS talentone_projekte (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projektnummer integer,
  projekt text,
  kunde text,
  closer text,
  projektart text,
  projektdauer text,
  status text DEFAULT 'vorbereitung',
  deadline_vorbereitung date,
  gesuchte_positionen text,
  standorte text,
  start_phase1 date, ende_phase1 date, phase1_einstellungen text,
  start_phase2 date, ende_phase2 date, phase2_einstellungen text,
  zufriedenheit integer CHECK (zufriedenheit IS NULL OR (zufriedenheit BETWEEN 1 AND 5)),
  startdatum_abo date, enddatum_abo date, pausiert_seit date,
  ziel_erreicht boolean DEFAULT false,
  re_bezahlt boolean DEFAULT false,
  re2_bezahlt boolean DEFAULT false,
  bewertet boolean DEFAULT false,
  notizen text,
  pixel text,
  ready_for_upsell boolean DEFAULT false,
  upsell_wer text,
  position_im_unternehmen text,
  persoenlichkeitstyp text,
  email text,
  verantwortlich text,
  fotograf text,
  letzter_kontakt date,
  kontaktstatus text,
  werbekosten text,
  close_lead_id text,
  kunde_id uuid REFERENCES talentone_kunden(id) ON DELETE SET NULL,
  checkliste jsonb DEFAULT '{
    "fb_zugang": false, "formular_verschickt": false, "fotograf_organisiert": false,
    "fotos_erhalten": false, "fotos_fertig": false, "formular_erhalten": false,
    "onboarding_formular": false, "creatives_erstellt": false, "adcopies_geschrieben": false,
    "url_bestellt": false, "url_connected": false, "url_verifiziert_fb": false,
    "events_gesetzt": false, "bewerberliste_erstellt": false, "zapier_eingerichtet": false,
    "entwuerfe_verschickt": false, "go_vom_kunden": false, "avv_unterzeichnet": false,
    "adresse_werbekonto": false, "geschenk_verschickt": false, "testi_vereinbaren": false
  }'::jsonb,
  airtable_record_id text UNIQUE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS projekte_status_idx ON talentone_projekte (status);
CREATE INDEX IF NOT EXISTS projekte_verantwortlich_idx ON talentone_projekte (verantwortlich);
CREATE INDEX IF NOT EXISTS projekte_kunde_id_idx ON talentone_projekte (kunde_id);

CREATE TABLE IF NOT EXISTS talentone_kommentare (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projekt_id uuid NOT NULL REFERENCES talentone_projekte(id) ON DELETE CASCADE,
  autor text,
  text text NOT NULL,
  erwaehnungen jsonb DEFAULT '[]'::jsonb,
  quelle text DEFAULT 'intern',
  airtable_comment_id text UNIQUE,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kommentare_projekt_idx ON talentone_kommentare (projekt_id);
CREATE INDEX IF NOT EXISTS kommentare_created_idx ON talentone_kommentare (created_at DESC);
