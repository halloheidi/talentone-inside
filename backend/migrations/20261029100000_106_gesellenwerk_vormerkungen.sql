-- Etappe 3: Gesellenwerk-Vormerkung (intern). Rein additiv.
-- Kandidaten, die beim TalentOne-Kunden nicht passen, aber grundsätzlich gut sind,
-- werden intern für den Gesellenwerk-Pool (gesellenwerk.de) vorgemerkt.
-- Technischer Sync zu Gesellenwerk folgt später; hier nur Datenhaltung.
-- Vormerkung hängt logisch an der PERSON (dubletten.js), gespeichert gegen einen
-- repräsentativen Eingang (bewerbung_id UNIQUE). Gewerk/Wohnort werden beim Lesen
-- aus Stelle/Funnel-Antworten abgeleitet, nicht kopiert.

create table if not exists public.talentone_gesellenwerk_vormerkungen (
  id uuid primary key default gen_random_uuid(),
  bewerbung_id uuid not null unique references public.talentone_bewerbungen(id) on delete cascade,
  status text not null default 'vorgeschlagen'
    check (status in ('vorgeschlagen','vorgemerkt','uebertragen','zurueckgezogen')),
  quelle text not null
    check (quelle in ('manuell','kundenabsage')),
  vorgemerkt_am timestamptz,
  vorgemerkt_von text,
  notiz text,
  einwilligung boolean not null default false,
  einwilligung_art text
    check (einwilligung_art is null or einwilligung_art in ('telefon','optin_mail')),
  einwilligung_am timestamptz,
  einwilligung_von text,
  optin_token uuid,
  optin_gesendet_am timestamptz,
  gesellenwerk_kandidat_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_gw_vormerkungen_status on public.talentone_gesellenwerk_vormerkungen(status);
create index if not exists idx_gw_vormerkungen_optin_token on public.talentone_gesellenwerk_vormerkungen(optin_token);

comment on table public.talentone_gesellenwerk_vormerkungen is
  'Etappe 3: interne Vormerkung von Kandidaten für den Gesellenwerk-Pool. Vormerkung gilt je Person (dubletten.js), gespeichert gegen einen Eingang. Niemals über Portal/Token-Zugänge erreichbar.';
