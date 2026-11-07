-- 115: Animierte Creatives (Higgsfield Seedance 2.5 → Video + Text-Overlay)
-- Additive Spalten an talentone_creatives. typ bleibt 'video' (wie Reels),
-- status nutzt 'processing' | 'fertig' | 'fehler'. bild_url = fertiges Overlay-mp4.
alter table talentone_creatives
  add column if not exists quelle text,                       -- 'higgsfield_video' für animierte Clips
  add column if not exists referenzbild_id uuid references talentone_referenzbilder(id) on delete set null,
  add column if not exists roh_video_url text,                -- Higgsfield-Rohvideo (vor Overlay) für Overlay-Retry
  add column if not exists higgsfield_request_id text,        -- Higgsfield request_id (Nachverfolgung)
  add column if not exists fehler text,                       -- Fehlermeldung bei status='fehler'
  add column if not exists kosten_credits numeric;            -- geloggte Higgsfield-Credits je Clip

create index if not exists idx_creatives_referenzbild on talentone_creatives (referenzbild_id);
