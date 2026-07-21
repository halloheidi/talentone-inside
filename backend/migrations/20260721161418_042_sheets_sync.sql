-- Google-Sheets-Sync: pro Kunde konfigurierbar (Multi-Job -> ein Sheet).
-- { enabled, spreadsheet_id, sheet_name } ; sheet_name leer = erstes Tabellenblatt.
alter table talentone_kunden
  add column if not exists sheets_sync jsonb;

-- Nachvollziehbarkeit + Idempotenz am Bewerbungs-Datensatz.
alter table talentone_bewerbungen
  add column if not exists sheets_synced_at timestamptz,
  add column if not exists sheets_row_number int;

comment on column talentone_kunden.sheets_sync is 'Google-Sheets-Sync-Config: {enabled:bool, spreadsheet_id:text, sheet_name:text}. Eingehende Bewerbungen aller Stellen dieses Kunden werden zusaetzlich (append-only) ins Sheet geschrieben. NULL/enabled=false = aus.';
comment on column talentone_bewerbungen.sheets_synced_at is 'Zeitpunkt des erfolgreichen Sheet-Schreibens (verhindert Doppel-Append bei Webhook-Retries).';
comment on column talentone_bewerbungen.sheets_row_number is 'Zeilennummer im Sheet (1-basiert) fuer spaetere Vorqual-Rueckschreibung in genau diese Zeile.';

-- Config fuer Clivet setzen (erstes Tabellenblatt -> sheet_name leer).
update talentone_kunden
  set sheets_sync = jsonb_build_object(
    'enabled', true,
    'spreadsheet_id', '1nXY9Zl6WUmyuDF5ObhExEudOzGwb5rQfggT9LvwNBlw',
    'sheet_name', ''
  )
  where id = '18bbfb99-f8b8-4b64-b08e-6fdf6e463cf9';
