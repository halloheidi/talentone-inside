# Migrations

SQL-Migrationen für das TalentOne Inside-Tool. Dieser Ordner ist der
**vollständige, reproduzierbare Schema-Stand** der Prod-DB (Supabase-Projekt
`fhvkbnbjnorsmsvrjizl`) — eine Datei je angewendeter Migration.

**Konvention**: `<version>_<name>.sql`, wobei `version` der Supabase-Timestamp
(`YYYYMMDDHHMMSS`) aus `supabase_migrations.schema_migrations` ist. Die Dateien
sortieren dadurch **chronologisch = Anwendungsreihenfolge** und kollidieren nie
(anders als das frühere `NNN_`-Schema, das doppelte Nummern hatte).

**Neue Migration anlegen**:
1. Nächste freie `version` bestimmen — NICHT nach Dateinamen raten, sondern die
   DB-History abfragen:
   `select version, name from supabase_migrations.schema_migrations order by version desc limit 5;`
   Eine `version` > DB-Max wählen (Timestamp-Format).
2. Datei `<version>_<name>.sql` anlegen.
3. Anwenden über Supabase MCP `apply_migration` (landet in der DB-History) —
   dann Repo und DB bleiben synchron.

**Wichtig**: RLS ist auf allen `talentone_*`-Tabellen aktiviert. Das Backend
liest/schreibt mit `SUPABASE_SERVICE_ROLE_KEY`, der die RLS umgeht. Es gibt
keine anon-facing Policies auf diesen Tabellen.

---

**Historie**: Der Ordner war zeitweise unvollständig (nur `001–021` + Ausreißer)
und die Nummerierung kollidierte. Am 2026-07-16 wurde er 1:1 aus der
DB-History (`schema_migrations.statements`) rekonstruiert — seither ist
Repo = DB. Ein `git log` auf die alten `NNN_*.sql`-Dateien zeigt die frühere Form.
