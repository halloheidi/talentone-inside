-- 073: Creative ↔ Ad-Copy-Verknüpfung (Neukundengewinnung).
-- Ein Creative hat höchstens EINE zugeordnete Copy; eine Copy kann mehreren Creatives
-- zugeordnet sein (Wiederverwendung). Copies ohne Zuordnung = „allgemeine Texte" (Pool).
-- ON DELETE SET NULL: wird die Copy gelöscht, bleibt das Creative erhalten (Zuordnung leer).
alter table talentone_creatives
  add column if not exists adcopy_id uuid references talentone_adcopies(id) on delete set null;

create index if not exists idx_creatives_adcopy_id on talentone_creatives(adcopy_id);
