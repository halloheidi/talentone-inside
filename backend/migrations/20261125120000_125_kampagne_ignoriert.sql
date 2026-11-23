-- 125: Kampagnen manuell als „nicht relevant" markierbar.
-- ignoriert=true nimmt eine Kampagne aus Wächtern (Pixel/Verbindung), Zuordnungs-
-- Badges (nicht-zugeordnet-Liste/-Zähler, Auto-Matching, Reaktivierung) und der
-- Laufzeit-/Kennzahlen-Aggregation (Controlling, Budget, Garantie, Reminder) heraus.
-- Typischer Fall: Produkt-/Showroom-Kampagnen im selben Werbekonto wie Recruiting.
alter table talentone_meta_kampagnen add column if not exists ignoriert boolean not null default false;
alter table talentone_meta_kampagnen add column if not exists ignoriert_grund text;
