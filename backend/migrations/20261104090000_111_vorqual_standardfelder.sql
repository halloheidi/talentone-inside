-- 111 — Standard-Vorqualifizierungsfelder (global, für JEDE Stelle).
-- Werte landen in talentone_bewerber_notizen.vorqualifizierung_werte unter dem
-- Schlüssel std_<id> (gleiche Struktur wie die stellenspezifischen Job-Felder),
-- damit Portal + Drawer nichts Neues brauchen. Ausnahme: notiz_feld-Felder
-- (gehaltswunsch, verfuegbarkeit) spiegeln bestehende Spalten → nicht doppelt
-- speichern. validierung: optionale Eingabe-Prüfung (z.B. 'plz').
create table if not exists talentone_vorqual_standardfelder (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  typ           text not null default 'text' check (typ in ('text','select','janein','zahl')),
  optionen      jsonb,
  notiz_feld    text,
  validierung   text,
  reihenfolge   int not null default 0,
  aktiv         boolean not null default true,
  sichtbar_fuer text not null default 'kunde' check (sichtbar_fuer in ('intern','kunde')),
  created_at    timestamptz not null default now()
);

-- Vorbelegung nur beim ersten Lauf (idempotent).
do $$
begin
  if not exists (select 1 from talentone_vorqual_standardfelder) then
    insert into talentone_vorqual_standardfelder (name, typ, optionen, notiz_feld, validierung, reihenfolge, sichtbar_fuer) values
      ('Erreichbarkeit',           'text',   null, null,             null,  10,  'kunde'),
      ('Wechselmotivation',        'text',   null, null,             null,  20,  'kunde'),
      ('Aktuelle Tätigkeit',       'text',   null, null,             null,  30,  'kunde'),
      ('Ausbildung abgeschlossen', 'text',   null, null,             null,  40,  'kunde'),
      ('Gehaltswunsch',            'text',   null, 'gehaltswunsch',  null,  50,  'kunde'),
      ('Montage ja/nein',          'janein', null, null,             null,  60,  'kunde'),
      ('Aktuelle PLZ',             'text',   null, null,             'plz', 70,  'kunde'),
      ('Verfügbarkeit',            'text',   null, 'verfuegbarkeit', null,  80,  'kunde'),
      ('Führerschein',             'janein', null, null,             null,  90,  'kunde'),
      ('Deutsch verständlich',     'janein', null, null,             null, 100,  'kunde');
  end if;
end $$;
