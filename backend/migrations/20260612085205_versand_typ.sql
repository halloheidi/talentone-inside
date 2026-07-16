ALTER TABLE talentone_versand ADD COLUMN IF NOT EXISTS typ text DEFAULT 'entwurf';
CREATE INDEX IF NOT EXISTS versand_typ_idx ON talentone_versand (typ);
