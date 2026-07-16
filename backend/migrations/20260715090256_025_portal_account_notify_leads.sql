-- Pro Portal-Account: soll dieser Account bei neuen Leads / Anfragen benachrichtigt werden?
ALTER TABLE talentone_portal_accounts
  ADD COLUMN IF NOT EXISTS benachrichtige_leads boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN talentone_portal_accounts.benachrichtige_leads IS
  'Wenn true: Account bekommt E-Mail bei neuen Anfragen (webhook /leads).';
