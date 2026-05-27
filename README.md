# TalentOne Inside

Internes Kampagnen-Tool für TalentOne-Mitarbeiter — verwaltet Kunden, Stellen, Creatives, Ad Copies und Funnels.

- **Frontend**: React + Vite + Supabase Auth — `/frontend`
- **Backend**: Node.js + Express + Supabase Service Role — `/backend`
- **DB**: gleiches Supabase-Projekt wie Recruifly (`fhvkbnbjnorsmsvrjizl`), Tabellen mit Prefix `talentone_`
- **Production**: https://inside.talent-one.de (Traefik + Docker-Compose auf VPS 69.62.116.44)

## Lokale Entwicklung

### Backend

```bash
cd backend
cp .env.example .env.local   # Werte eintragen
npm install
npm run dev                  # http://localhost:3001
```

### Frontend

```bash
cd frontend
cp .env.example .env.local   # Werte eintragen
npm install
npm run dev                  # http://localhost:5173
```

## Deployment

Siehe [DEPLOY.md](./DEPLOY.md).

## Datenbank

Tabellen sind in der Migration `talentone_inside_schema` (Recruifly-Projekt) angelegt. RLS ist überall aktiv — Backend zugreift mit Service Role, Frontend zugreift NUR über Backend-API.

| Tabelle               | Zweck                                       |
|-----------------------|---------------------------------------------|
| `talentone_kunden`    | Firmen, für die wir Kampagnen erstellen     |
| `talentone_jobs`      | Stellen pro Kunde                           |
| `talentone_creatives` | Bilder/Videos pro Stelle                    |
| `talentone_adcopies`  | Werbetexte pro Stelle                       |
| `talentone_funnels`   | Bewerbungs-Funnel pro Stelle                |

## Login-Verwaltung

Mitarbeiter werden im Supabase-Dashboard unter **Authentication → Users** angelegt (Recruifly-Projekt). Es gibt bewusst keine Self-Registration.
