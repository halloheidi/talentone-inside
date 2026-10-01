-- Kunden-Dokumente (hochgeladene Formulare/Unterlagen, PDF/DOCX) in der Akte.
-- Bisher wurden nur Bilder (Logo/Fotos) abgelegt — Formular-PDFs gingen verloren.
-- Diese Dokumente können per „Auswerten" in neukunden_daten-Vorschläge gemappt werden.
create table if not exists talentone_kunden_dokumente (
  id            uuid primary key default gen_random_uuid(),
  kunde_id      uuid not null references talentone_kunden(id) on delete cascade,
  job_id        uuid references talentone_jobs(id) on delete set null,
  datei_url     text not null,
  storage_path  text,
  dateiname     text,
  content_type  text,
  uploaded_via  text default 'intern',
  created_at    timestamptz not null default now()
);
create index if not exists talentone_kunden_dokumente_kunde_idx on talentone_kunden_dokumente (kunde_id);
alter table talentone_kunden_dokumente enable row level security;

-- Öffentlicher Bucket (wie talentone-logos/-referenzbilder) für die Dokument-Dateien.
insert into storage.buckets (id, name, public)
values ('talentone-kunden-dokumente', 'talentone-kunden-dokumente', true)
on conflict (id) do nothing;
