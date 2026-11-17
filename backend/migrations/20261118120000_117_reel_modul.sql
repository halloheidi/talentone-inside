-- Reel-Modul R1: Tabellen für Recruiting-Reels (Skript + Motive + Bilder; Video folgt in R2).
-- Siehe docs/reel-modul-spec.md. Keine Check-Constraints auf status/stil/anrede — Validierung im Backend-Whitelist.

create table if not exists talentone_reels (
  id uuid primary key default gen_random_uuid(),
  kunde_id uuid not null references talentone_kunden(id) on delete cascade,
  job_ids uuid[] not null,
  projekt_id uuid,
  stil text not null default 'foto',            -- foto | illustration | 3d
  anrede text not null default 'du',            -- du | sie
  stimme text not null default 'dylan',         -- dylan (du) | harrison (sie) | ...
  status text not null default 'entwurf',       -- entwurf | skript_ok | bilder_ok | rendert | fertig | fehler
  gehalt_anzeigen boolean not null default false,
  skript jsonb,          -- [{nr, text, zeilen:[..], schluesselwoerter:[..], motiv_nr, dauer_s}]
  master_prompt text,
  motive jsonb,          -- [{nr, titel, prompt, bewegung, referenz_ids[], bild_url, bild_quelle (ki|upload|referenz), volle_breite, freigegeben}]
  referenzen jsonb,      -- {person: referenzbild_id|null, logo_url, fahrzeug: referenzbild_id|null, gebaeude: referenzbild_id|null}
  audio jsonb,           -- {voice_url, dauer_s, worttimings:[{w,start,end}], musik_url}  (R2)
  clips jsonb,           -- [{motiv_nr, job_id, url, dauer_s, status, credits}]           (R2)
  endkarte jsonb,        -- {titel, untertitel, button, farbe_hg, farbe_text}
  video_url text,        -- (R2)
  kosten jsonb,          -- {openai_usd, higgsfield_credits, elevenlabs_credits, gesamt_credits}
  fehler text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text
);

create index if not exists idx_reels_kunde on talentone_reels(kunde_id);
create index if not exists idx_reels_status on talentone_reels(status);

create table if not exists talentone_reel_kosten_log (
  id bigserial primary key,
  reel_id uuid references talentone_reels(id) on delete cascade,
  schritt text,           -- bild | voice | clip | render
  anbieter text,          -- openai | higgsfield | elevenlabs | render
  menge numeric,          -- Sekunden, Bilder …
  credits numeric,
  usd numeric,
  request_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_reel_kosten_reel on talentone_reel_kosten_log(reel_id);
