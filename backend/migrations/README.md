# Migrations

Nummerierte SQL-Migrationen für das TalentOne Inside-Tool.

**Konvention**: `NNN_kurzbeschreibung.sql`, aufsteigend nummeriert.

**Anwenden**:
- Bevorzugt: über Supabase MCP (`apply_migration`) — Migrationen landen in der
  offiziellen Migrations-History der Supabase-DB (`supabase_migrations.schema_migrations`).
- Alternativ: SQL im Supabase Studio → SQL Editor manuell ausführen.

**Wichtig**: RLS ist auf allen `talentone_*`-Tabellen aktiviert. Backend
liest/schreibt mit `SUPABASE_SERVICE_ROLE_KEY`, der die RLS umgeht. Es gibt
keine anon-facing Policies auf diesen Tabellen.
