-- Sammel-Debounce für Kunden-Uploads (Logo/Fotos über den Upload-Link).
-- Ziel: nicht pro Datei eine Mail, sondern eine gebündelte Mail, sobald 30 Min
-- kein weiterer Upload desselben Kunden kam. Eine Zeile pro Kunde.
create table if not exists talentone_upload_benachrichtigung (
  kunde_id uuid primary key references talentone_kunden(id) on delete cascade,
  letzter_upload_at timestamptz not null default now(),
  dateien jsonb not null default '[]'::jsonb,   -- [{typ, dateiname, at}]
  gemeldet_at timestamptz                        -- null = noch nicht gemeldet
);

-- Atomarer Upsert: hängt eine Datei an die offene Sammlung an (bzw. startet eine
-- neue, wenn die vorige bereits gemeldet wurde) und setzt gemeldet_at zurück.
create or replace function vermerke_upload(p_kunde_id uuid, p_typ text, p_dateiname text)
returns void language sql as $$
  insert into talentone_upload_benachrichtigung (kunde_id, letzter_upload_at, dateien, gemeldet_at)
  values (
    p_kunde_id, now(),
    jsonb_build_array(jsonb_build_object('typ', p_typ, 'dateiname', p_dateiname, 'at', now())),
    null
  )
  on conflict (kunde_id) do update set
    letzter_upload_at = now(),
    gemeldet_at = null,
    dateien = case
      when talentone_upload_benachrichtigung.gemeldet_at is not null
        then jsonb_build_array(jsonb_build_object('typ', p_typ, 'dateiname', p_dateiname, 'at', now()))
      else talentone_upload_benachrichtigung.dateien || jsonb_build_object('typ', p_typ, 'dateiname', p_dateiname, 'at', now())
    end;
$$;
