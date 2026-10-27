-- Umbau „Projekt in die Stelle": jede Stelle ohne projekt_id bekommt ihr eigenes Projekt.
-- Rein additiv: legt nur fehlende Projekte an (status 'vorbereitung', vertragsmodell leer)
-- und verknüpft die Stelle. Bestehende Verknüpfungen bleiben unberührt.
-- (Angewendet 28.10.2026: 3 Backfill-Kandidaten → 3 neue Projekte, projekte_live 22→22 unverändert.)

-- 1) Fehlende Projekte anlegen (eins je (kunde_id, stelle), falls noch keins existiert)
insert into talentone_projekte (kunde_id, projekt, kunde, status, gesuchte_positionen, standorte, projektart, agentur, updated_at)
select distinct on (j.kunde_id, trim(j.stelle))
  j.kunde_id, trim(j.stelle), k.firmenname,
  'vorbereitung',
  trim(j.stelle), j.region,
  case when j.projekttyp = 'neukundengewinnung' then 'Neukundengewinnung'
       when k.agentur = 'talentone' then 'TalentOne - Mitarbeitergewinnung'
       else 'Mitarbeitergewinnung' end,
  case when k.agentur = 'nowagwirth' then 'nowagwirth' else 'talentone' end,
  now()
from talentone_jobs j
join talentone_kunden k on k.id = j.kunde_id
where j.projekt_id is null and j.kunde_id is not null and coalesce(trim(j.stelle),'') <> ''
  and not exists (select 1 from talentone_projekte p where p.kunde_id = j.kunde_id and p.projekt = trim(j.stelle));

-- 2) Stellen mit dem passenden Projekt (kunde_id, stelle) verknüpfen
update talentone_jobs j
set projekt_id = p.id
from talentone_projekte p
where j.projekt_id is null and j.kunde_id is not null and coalesce(trim(j.stelle),'') <> ''
  and p.kunde_id = j.kunde_id and p.projekt = trim(j.stelle);
