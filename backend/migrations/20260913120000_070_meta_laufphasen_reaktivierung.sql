-- 070: Meta-Laufphasen, Reaktivierungs-Erkennung, Zahlungsproblem-Erkennung.
--
-- Laufphasen: aus den Tages-Insights abgeleitete zusammenhängende Aktivitätszeiträume
-- (Spend > 0). Eine Lücke von > REAKT_SCHWELLE Tagen (Default 60) beendet die Phase;
-- erneute Aktivität startet eine neue Phase. ALLE laufzeitbasierten Features
-- (Lauftage-Anzeige, 30-Tage-Rechnungs-Reminder, Garantie-Wächter, Projektdauer)
-- rechnen ab Start der AKTUELLEN Phase in AKTIVEN LAUFTAGEN (Tage mit Spend > 0) —
-- nie ab meta_start_time und nie in Kalendertagen.
create table if not exists talentone_meta_laufphasen (
  id uuid primary key default gen_random_uuid(),
  meta_campaign_id text not null references talentone_meta_kampagnen(meta_campaign_id) on delete cascade,
  phase_start date not null,           -- erster Aktiv-Tag der Phase
  phase_ende date,                     -- letzter Aktiv-Tag; NULL = laufend/aktuell offen
  quelle text not null default 'auto' check (quelle in ('auto','manuell')),
  aktive_lauftage integer not null default 0,   -- Tage mit Spend > 0 in dieser Phase
  letzter_aktiv_tag date,              -- jüngster Tag mit Spend > 0
  spend_summe numeric,                 -- Spend-Summe der Phase (für Historie-Anzeige)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meta_campaign_id, phase_start)
);
create index if not exists idx_meta_laufphasen_campaign on talentone_meta_laufphasen(meta_campaign_id);

-- Reaktivierungs-Nachfrage (statt stiller Automatik): der Sync legt bei Reaktivierung
-- eine neue Phase an UND markiert die Kampagne, bis ein Mensch bestätigt hat.
alter table talentone_meta_kampagnen add column if not exists reaktivierung_offen boolean not null default false;
alter table talentone_meta_kampagnen add column if not exists reaktivierung_am date;             -- erster Aktiv-Tag der neuen Phase
alter table talentone_meta_kampagnen add column if not exists reaktivierung_pause_tage integer;  -- Länge der Lücke davor (Kalendertage)
alter table talentone_meta_kampagnen add column if not exists reaktivierung_mail_am timestamptz;  -- Dedup: wann zuletzt gemailt
-- „Zusammenhängend zählen" (Sonderfall): Kampagne wird als EINE durchgehende Phase
-- gerechnet, die 60-Tage-Schwelle splittet sie nicht mehr (sticky gegen Auto-Recompute).
alter table talentone_meta_kampagnen add column if not exists laufphasen_manuell boolean not null default false;

-- Zahlungsproblem-Erkennung am Werbekonto (account_status 2 = deaktiviert,
-- 3 = Zahlung ausstehend/unsettled; disable_reason wo vorhanden). Wiederholungs-Mail
-- höchstens alle 3 Tage, solange der Zustand anhält.
alter table talentone_meta_konten add column if not exists account_status integer;
alter table talentone_meta_konten add column if not exists disable_reason text;
alter table talentone_meta_konten add column if not exists zahlungsproblem boolean not null default false;
alter table talentone_meta_konten add column if not exists zahlungsproblem_seit date;
alter table talentone_meta_konten add column if not exists zahlungsproblem_mail_am timestamptz;
alter table talentone_meta_konten add column if not exists status_gesynct timestamptz;
