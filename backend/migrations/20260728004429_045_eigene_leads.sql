-- Eigene Meta-Lead-Ads-Leads: Konfigurierbare Sheet-Quellen + importierte Leads.
create table if not exists talentone_lead_quellen (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  spreadsheet_id text not null,
  sheet_name text,
  aktiv boolean not null default true,
  benachrichtigung boolean not null default true,
  -- Close-Task
  close_task_text text,
  close_task_assignee text,                 -- Close user id (user_...)
  close_task_faelligkeit jsonb default '{"mode":"today"}'::jsonb, -- {mode:'today'|'plus_days', days:int}
  -- Feste Close-Werte je Lead dieser Quelle: [{field_id, field_name, value}]
  close_fixed_fields jsonb default '[]'::jsonb,
  close_lead_status_id text,
  -- Optionales Spalten->Custom-Field-Mapping: [{sheet_col, close_field_id, close_field_name}]
  spalten_mapping jsonb default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists talentone_eigene_leads (
  id uuid primary key default gen_random_uuid(),
  quelle_id uuid references talentone_lead_quellen(id) on delete set null,
  quelle_name text,
  name text,
  email text,
  telefon text,
  kampagne text,
  daten jsonb not null default '{}'::jsonb,   -- alle Formular-Antworten (header-basiert)
  row_hash text not null,                      -- Dedup (Inhalts-Hash, robust gegen Meta-Doppelzeilen)
  close_lead_id text,
  close_task_id text,
  close_status text not null default 'ausstehend',  -- 'ok' | 'ausstehend' | 'fehler'
  close_error text,
  close_sync_versuche int not null default 0,
  ist_test boolean not null default false,
  created_at timestamptz not null default now(),
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists eigene_leads_dedup on talentone_eigene_leads(quelle_id, row_hash);
create index if not exists eigene_leads_status_idx on talentone_eigene_leads(close_status);
create index if not exists eigene_leads_created_idx on talentone_eigene_leads(created_at desc);

comment on table talentone_lead_quellen is 'Konfigurierbare Sheet-Quellen fuer eigene Meta-Lead-Ads (N&W Solar etc.) inkl. Close-Mapping.';
comment on table talentone_eigene_leads is 'Importierte eigene Leads aus Meta-Lead-Ads-Sheets; Dedup via row_hash; Close-Sync-Status.';
