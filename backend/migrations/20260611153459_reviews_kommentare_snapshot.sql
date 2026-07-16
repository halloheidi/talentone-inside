ALTER TABLE talentone_reviews ADD COLUMN IF NOT EXISTS kommentare_snapshot jsonb DEFAULT '{}'::jsonb;
