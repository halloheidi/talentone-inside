-- Creative-Wizard V2 (paralleler Test-Reiter) — Etappe 1: Feature-Flags + Einwilligungs-/
-- Diagnose-Flags pro Foto. Rein additiv; der bestehende Generator bleibt unberührt.

-- Per-Nutzer-Feature-Flags (email NULL = globaler Default). Resolution: Nutzer > global > Code-Default.
create table if not exists talentone_feature_flags (
  id         uuid primary key default gen_random_uuid(),
  flag       text not null,
  email      text,                       -- NULL = globaler Default
  enabled    boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text
);
create unique index if not exists talentone_feature_flags_uniq on talentone_feature_flags (flag, coalesce(email, ''));
alter table talentone_feature_flags enable row level security;

-- Einwilligungs- + Diagnose-Flags pro Foto (gelten global, stören den Alt-Pfad nicht,
-- da der Alt-Generator sie schlicht ignoriert).
alter table talentone_referenzbilder
  add column if not exists werbefreigabe text not null default 'ungeklaert',
  add column if not exists ki_verarbeitung_erlaubt boolean not null default true,
  add column if not exists hat_person boolean,               -- Personen-Flag (manuell, NULL = unbekannt)
  add column if not exists personen_zustimmung boolean not null default false,
  add column if not exists personen_zustimmung_am timestamptz;

do $$
begin
  if not exists (select 1 from information_schema.check_constraints
    where constraint_schema='public' and constraint_name='talentone_referenzbilder_werbefreigabe_check') then
    alter table talentone_referenzbilder
      add constraint talentone_referenzbilder_werbefreigabe_check
      check (werbefreigabe in ('ja','nein','ungeklaert'));
  end if;
end $$;

comment on column talentone_referenzbilder.ki_verarbeitung_erlaubt is
  'false → externe Bild-APIs (gpt-image) für dieses Foto gesperrt; serverseitige Pfade (Overlay/Vorlagen/ffmpeg) bleiben erlaubt.';
