-- portal_zugang: 'link' (Default) oder 'account'
ALTER TABLE talentone_kunden
  ADD COLUMN IF NOT EXISTS portal_zugang TEXT NOT NULL DEFAULT 'link'
    CHECK (portal_zugang IN ('link', 'account'));

COMMENT ON COLUMN talentone_kunden.portal_zugang IS
  'link: Portal ist per Token-URL ohne Login erreichbar. account: Login mit E-Mail + Passwort ueber talentone_portal_accounts.';

-- Portal-Accounts (echter Login pro Kunde)
CREATE TABLE IF NOT EXISTS talentone_portal_accounts (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kunde_id               UUID NOT NULL REFERENCES talentone_kunden(id) ON DELETE CASCADE,
  email                  TEXT NOT NULL,
  name                   TEXT,
  password_hash          TEXT,
  einladungs_token       UUID DEFAULT gen_random_uuid(),
  einladung_gesendet_at  TIMESTAMPTZ,
  passwort_gesetzt_at    TIMESTAMPTZ,
  letzter_login          TIMESTAMPTZ,
  aktiv                  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS talentone_portal_accounts_email_uidx
  ON talentone_portal_accounts (LOWER(email));
CREATE INDEX IF NOT EXISTS talentone_portal_accounts_kunde_idx
  ON talentone_portal_accounts (kunde_id);
CREATE UNIQUE INDEX IF NOT EXISTS talentone_portal_accounts_einladung_uidx
  ON talentone_portal_accounts (einladungs_token) WHERE einladungs_token IS NOT NULL;

ALTER TABLE talentone_portal_accounts ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'talentone_portal_accounts' AND policyname = 'service_role_all') THEN
    CREATE POLICY service_role_all ON talentone_portal_accounts FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- Freiflächen-Kunde → variogreen energy, portal_zugang=account
UPDATE talentone_kunden
SET firmenname = 'variogreen energy',
    portal_zugang = 'account'
WHERE id = '68f23ef4-1f55-41a0-998e-a697d69849e1';

-- Job umbenennen fuer Konsistenz
UPDATE talentone_jobs
SET stelle = 'Freiflächen-Pipeline (variogreen)'
WHERE kunde_id = '68f23ef4-1f55-41a0-998e-a697d69849e1'
  AND stelle = 'Freiflächen-Pipeline';

-- Projekt in Kanban anlegen (falls noch nicht vorhanden)
INSERT INTO talentone_projekte (
  projekt, kunde, kunde_id, status, agentur, projektart,
  gesuchte_positionen, close_lead_id, updated_at
)
SELECT
  'Freiflächen-Pipeline (variogreen)',
  'variogreen energy',
  '68f23ef4-1f55-41a0-998e-a697d69849e1',
  'live',                       -- laeuft seit Ewigkeiten, direkt live
  'nowagwirth',
  'Neukundengewinnung',
  'Freiflaechen-Akquise',
  NULL,
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM talentone_projekte WHERE kunde_id = '68f23ef4-1f55-41a0-998e-a697d69849e1'
);
