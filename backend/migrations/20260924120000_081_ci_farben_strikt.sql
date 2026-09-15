-- Strikte CI-Farben: exakte Hex-Werte statt KI-Approximation.
alter table talentone_kunden add column if not exists ci_farben_strikt boolean not null default false;
alter table talentone_kunden add column if not exists farben_verifiziert boolean not null default false;

-- Per-Creative-Override (null = Kunden-Default erben) + Typo-Stil-Preset.
alter table talentone_creatives add column if not exists ci_farben_strikt boolean;
alter table talentone_creatives add column if not exists text_stil text;
