-- Explizite Garantie-Art am Angebot. Bisher war Garantie implizit an
-- guarantee_period_days (>0) gekoppelt und wurde faelschlich auch dann als
-- Position gerendert, wenn keine gewaehlt war (Template schlug durch).
--   none         = keine Garantie
--   hire         = Erfolgs-/Einstellungsgarantie (kostenlose Weiterarbeit bis Einstellung)
--   applications = Bewerbungs-Garantie (Mindestanzahl Bewerbungen), nur TalentOne
alter table talentone_offers
  add column if not exists guarantee_type text,
  add column if not exists guarantee_applications_count int;

-- Backfill: bestehende Angebote mit Garantie-Frist > 0 waren Einstellungsgarantien.
update talentone_offers
  set guarantee_type = case when coalesce(guarantee_period_days, 0) > 0 then 'hire' else 'none' end
  where guarantee_type is null;

alter table talentone_offers
  alter column guarantee_type set default 'none';

alter table talentone_offers
  drop constraint if exists talentone_offers_guarantee_type_chk;
alter table talentone_offers
  add constraint talentone_offers_guarantee_type_chk
  check (guarantee_type is null or guarantee_type in ('none','hire','applications'));

comment on column talentone_offers.guarantee_type is 'Garantie-Art: none | hire (Einstellungsgarantie) | applications (Bewerbungs-Garantie, nur TalentOne). Steuert, OB und WELCHE Garantie-Position im Angebot erscheint.';
comment on column talentone_offers.guarantee_applications_count is 'Nur bei guarantee_type=applications: garantierte Mindestanzahl Bewerbungen.';
