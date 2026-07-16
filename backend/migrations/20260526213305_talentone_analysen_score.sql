ALTER TABLE talentone_analysen
  ADD COLUMN IF NOT EXISTS score integer CHECK (score IS NULL OR (score BETWEEN 1 AND 10)),
  ADD COLUMN IF NOT EXISTS score_summary text,
  ADD COLUMN IF NOT EXISTS score_levers jsonb;
