ALTER TABLE talentone_jobs
  ADD COLUMN IF NOT EXISTS vorqualifizierung boolean DEFAULT false;
