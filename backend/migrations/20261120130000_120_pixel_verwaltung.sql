-- 120: Meta-Pixel-Verwaltung. Ein Pixel je Gewerk + ein Fallback-Pixel.
-- Spiegel des bereits in der DB angelegten Schemas (idempotent). Die Zeilen
-- (10 Pixel) sind separat eingespielt und werden hier NICHT erneut geseedet.
-- „Genau ein fallback=true" wird in der App erzwungen (routes/pixel.js), nicht
-- per DB-Constraint.
create table if not exists talentone_pixel (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  gewerk        text not null,
  meta_pixel_id text not null unique,
  aktiv         boolean not null default true,
  fallback      boolean not null default false,
  notiz         text,
  created_at    timestamptz not null default now()
);

-- Zuordnung je Stelle (NULL = noch kein Pixel). Vorschlag per Gewerk-Mapping
-- (backend/pixel-mapping.js); gesetzt wird nur explizit bzw. beim Anlegen.
alter table talentone_jobs
  add column if not exists pixel_id uuid references talentone_pixel(id);

create index if not exists talentone_jobs_pixel_id_idx on talentone_jobs(pixel_id);
