-- Bestandskunden-Modul: eigenständige Reaktivierungs-Steuerzentrale (kein Bezug
-- zu talentone_kunden). Rechnungshistorie aus Altsystem (Lexoffice) + easybill.
create table if not exists talentone_bk_kunden (
  id uuid primary key default gen_random_uuid(),
  kundennummer text not null,
  firma text not null,
  fruehere_bezeichnung text,
  plz text,
  ort text,
  ansprechpartner text,
  telefon text,
  email text,
  reaktivierung text not null default 'offen' check (reaktivierung in ('offen','angehen','verbrannt')),
  zustaendig_close_user_id text,
  notiz text,
  close_lead_id text,
  close_task_id text,
  close_task_status text not null default 'kein_task' check (close_task_status in ('kein_task','offen','erledigt')),
  quelle text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kundennummer, firma)
);
create index if not exists idx_bk_kunden_reaktivierung on talentone_bk_kunden(reaktivierung);
create index if not exists idx_bk_kunden_kundennummer on talentone_bk_kunden(kundennummer);

create table if not exists talentone_bk_rechnungen (
  id uuid primary key default gen_random_uuid(),
  bk_kunde_id uuid not null references talentone_bk_kunden(id) on delete cascade,
  dokument_nr text,
  easybill_document_id text,
  datum date not null,
  art text not null check (art in ('INVOICE','STORNO','CREDIT')),
  netto numeric(12,2),
  brutto numeric(12,2),
  quelle text,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_bk_rechnungen_easybill on talentone_bk_rechnungen(easybill_document_id);
create index if not exists idx_bk_rechnungen_kunde on talentone_bk_rechnungen(bk_kunde_id);

-- Sync-Protokoll (easybill + close)
create table if not exists talentone_bk_sync_log (
  id uuid primary key default gen_random_uuid(),
  quelle text not null,
  gestartet_at timestamptz not null default now(),
  beendet_at timestamptz,
  neu integer default 0,
  aktualisiert integer default 0,
  fehler integer default 0,
  meldung text
);

-- Übersicht: Aggregate IMMER aus Rechnungen berechnet (nie manuell gepflegt).
-- Umsatz = Summe netto über alle Arten (Stornos/Gutschriften negativ);
-- Anzahl + Datums-Aggregate nur INVOICE. Status aus letzter Rechnung abgeleitet.
create or replace view talentone_bk_kunden_uebersicht as
select
  k.*,
  agg.erste_rechnung,
  agg.letzte_rechnung,
  coalesce(agg.anzahl_rechnungen, 0) as anzahl_rechnungen,
  coalesce(agg.umsatz_netto, 0)      as umsatz_netto,
  case
    when agg.letzte_rechnung is null then 'inaktiv_2plus'
    when agg.letzte_rechnung >= (current_date - interval '12 months') then 'aktiv'
    when agg.letzte_rechnung >= (current_date - interval '24 months') then 'inaktiv_1_2'
    else 'inaktiv_2plus'
  end as status
from talentone_bk_kunden k
left join lateral (
  select
    min(r.datum) filter (where r.art = 'INVOICE') as erste_rechnung,
    max(r.datum) filter (where r.art = 'INVOICE') as letzte_rechnung,
    count(*)     filter (where r.art = 'INVOICE') as anzahl_rechnungen,
    sum(r.netto)                                  as umsatz_netto
  from talentone_bk_rechnungen r
  where r.bk_kunde_id = k.id
) agg on true;
