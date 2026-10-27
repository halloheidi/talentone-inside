-- Garantie-Ziel in Bewerbungen (z. B. „Garantie: 20 Bewerbungen"). Rein additiv.
alter table talentone_projekte add column if not exists garantie_bewerbungen integer;
