-- Status: 'wartend' = Kunde muss Formular noch ausfüllen, 'aktiv' = Standard
-- Default 'aktiv' für Bestehende, neue Formular-Kunden werden mit 'wartend' angelegt.
alter table public.talentone_kunden
  add column if not exists status text not null default 'aktiv'
  check (status in ('wartend', 'aktiv'));

-- Token für die Public-Formular-Seite (separat vom upload_token)
alter table public.talentone_kunden
  add column if not exists formular_token text unique;
