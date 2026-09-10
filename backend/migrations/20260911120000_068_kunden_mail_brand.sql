-- 068: Brand für die Neukunden-Anfrage-Mails (sendAnfrageMail), pro Kunde konfigurierbar.
-- Default 'talentone' = bisheriges Verhalten (kein Override). Erlaubte Werte vorerst
-- 'talentone' und 'nw_solar'; bewusst OHNE CHECK-Constraint, damit unbekannte/künftige
-- Werte nicht brechen (Code fällt bei Unbekanntem auf TalentOne zurück).
alter table talentone_kunden add column if not exists mail_brand text not null default 'talentone';

-- solar-projects-solution GmbH → N&W-Solar-Branding.
update talentone_kunden set mail_brand = 'nw_solar'
  where id = 'f9878eb2-d6ae-4b39-b5b3-ac63409fcac1';
