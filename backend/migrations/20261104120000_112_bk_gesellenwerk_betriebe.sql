-- Gesellenwerk-Vormerkung für BETRIEBE (getrennt vom Kandidaten-Pool).
-- Steuerfelder auf talentone_bk_kunden + in der Übersichts-View exponiert.
alter table talentone_bk_kunden
  add column if not exists gw_status text,
  add column if not exists gw_status_am timestamptz,
  add column if not exists gw_status_von text,
  add column if not exists gw_notiz text;

alter table talentone_bk_kunden drop constraint if exists talentone_bk_kunden_gw_status_chk;
alter table talentone_bk_kunden add constraint talentone_bk_kunden_gw_status_chk
  check (gw_status is null or gw_status in ('interessant','angesprochen','registriert','kein_interesse'));

-- View um die gw-Felder erweitern (am Ende anhängen → CREATE OR REPLACE-konform).
create or replace view talentone_bk_kunden_uebersicht as
 SELECT k.id,
    k.kundennummer,
    k.firma,
    k.fruehere_bezeichnung,
    k.plz,
    k.ort,
    k.ansprechpartner,
    k.telefon,
    k.email,
    k.reaktivierung,
    k.zustaendig_close_user_id,
    k.notiz,
    k.close_lead_id,
    k.close_task_id,
    k.close_task_status,
    k.quelle,
    k.created_at,
    k.updated_at,
    agg.erste_rechnung,
    agg.letzte_rechnung,
    COALESCE(agg.anzahl_rechnungen, 0::bigint) AS anzahl_rechnungen,
    COALESCE(agg.umsatz_netto, 0::numeric) AS umsatz_netto,
        CASE
            WHEN agg.letzte_rechnung IS NULL THEN 'inaktiv_2plus'::text
            WHEN agg.letzte_rechnung >= (CURRENT_DATE - '1 year'::interval) THEN 'aktiv'::text
            WHEN agg.letzte_rechnung >= (CURRENT_DATE - '2 years'::interval) THEN 'inaktiv_1_2'::text
            ELSE 'inaktiv_2plus'::text
        END AS status,
    k.gw_status,
    k.gw_status_am,
    k.gw_status_von,
    k.gw_notiz
   FROM talentone_bk_kunden k
     LEFT JOIN LATERAL ( SELECT min(r.datum) FILTER (WHERE r.art = 'INVOICE'::text) AS erste_rechnung,
            max(r.datum) FILTER (WHERE r.art = 'INVOICE'::text) AS letzte_rechnung,
            count(*) FILTER (WHERE r.art = 'INVOICE'::text) AS anzahl_rechnungen,
            sum(r.netto) AS umsatz_netto
           FROM talentone_bk_rechnungen r
          WHERE r.bk_kunde_id = k.id) agg ON true;
