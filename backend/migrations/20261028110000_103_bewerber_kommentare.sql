-- Gemeinsamer Kommentar-Verlauf je Bewerbung (Kunde + N&W), ersetzt den isolierten
-- bewerber_kundenfeedback.notizen-Freitext. Rein additiv.
-- (Angewendet 28.10.2026: 32 bestehende Kunden-Notizen als Kommentar migriert.)
create table if not exists talentone_bewerber_kommentare (
  id uuid primary key default gen_random_uuid(),
  bewerbung_id uuid not null references talentone_bewerbungen(id) on delete cascade,
  autor_typ text not null check (autor_typ in ('kunde','nw')),
  autor_name text,
  text text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_bewerber_kommentare_bewerbung on talentone_bewerber_kommentare(bewerbung_id, created_at);

-- Einmalige Migration: bestehende Kunden-Notiz aus dem Feedback als Kommentar (autor_typ 'kunde').
insert into talentone_bewerber_kommentare (bewerbung_id, autor_typ, autor_name, text, created_at)
select f.bewerbung_id, 'kunde', 'Kunde', trim(f.notizen), coalesce(f.updated_at, now())
from talentone_bewerber_kundenfeedback f
where coalesce(trim(f.notizen),'') <> ''
  and not exists (select 1 from talentone_bewerber_kommentare k where k.bewerbung_id = f.bewerbung_id and k.text = trim(f.notizen));
