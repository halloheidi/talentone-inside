-- 116 · Teilbare Unterlagen-Links (Share-Tokens für einzelne Bewerber-Anhänge).
--
-- Der Kunde erzeugt im Portal pro Anhang einen stabilen Share-Link /u/:share_token.
-- Beim Aufruf (kein Login, kein Portal-Token nötig) erzeugt das Backend eine frische,
-- kurzlebige Signed URL für GENAU diesen einen Anhang. Keine Bewerberdaten drumherum.
-- Gültigkeit 30 Tage, widerrufbar, jeder Aufruf wird protokolliert.

create table if not exists talentone_anhang_shares (
  id               uuid primary key default gen_random_uuid(),
  bewerbung_id     uuid not null references talentone_bewerbungen(id) on delete cascade,
  anhang_index     int  not null,
  share_token      text not null unique,
  kunde_id         uuid references talentone_kunden(id) on delete set null,
  erstellt_von     text,                                   -- 'kunde' (Portal) oder interne Nutzer-Kennung
  erstellt_am      timestamptz not null default now(),
  gueltig_bis      timestamptz not null default (now() + interval '30 days'),
  aufrufe          int  not null default 0,
  letzter_aufruf_am timestamptz,
  widerrufen_am    timestamptz
);

create index if not exists idx_anhang_shares_bewerbung on talentone_anhang_shares(bewerbung_id, anhang_index);
create index if not exists idx_anhang_shares_token on talentone_anhang_shares(share_token);
