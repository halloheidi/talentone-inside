-- Partieller Unique-Index taugt nicht als ON-CONFLICT-Ziel (PostgREST). Ein
-- normaler Unique-Index auf easybill_document_id erlaubt beliebig viele NULLs
-- (Altsystem-Rechnungen) und erzwingt Eindeutigkeit nur für easybill-Belege.
drop index if exists uq_bk_rechnungen_easybill;
create unique index if not exists uq_bk_rechnungen_easybill
  on talentone_bk_rechnungen(easybill_document_id);
