-- 074: Logo-Overlay ohne weiße Plakette (transparentes Logo direkt aufs Motiv).
-- Pro Creative überschreibbar; neue Creatives erben den Kunden-Default.
-- true  = weiße abgerundete Fläche hinter dem Logo (bisheriges Verhalten, Default).
-- false = Plakette weglassen, transparentes Logo direkt aufs Motiv (+ dezenter Schatten).
alter table talentone_creatives
  add column if not exists logo_weisse_flaeche boolean not null default true;

-- Kunden-Default: „Logo ohne weiße Fläche bevorzugen". Neue Creatives des Kunden erben ihn.
alter table talentone_kunden
  add column if not exists logo_ohne_flaeche_default boolean not null default false;
