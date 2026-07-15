# Deployment — TalentOne Inside

Ziel: `https://inside.talent-one.de` läuft über Traefik auf dem VPS `69.62.116.44`.

## 1. DNS

A-Record im DNS-Provider:

```
inside.talent-one.de   A   69.62.116.44
```

Verifizieren: `dig +short inside.talent-one.de` → `69.62.116.44`.

## 2. Mitarbeiter-Login in Supabase anlegen

Im Recruifly-Projekt (`fhvkbnbjnorsmsvrjizl`):

1. **Authentication → Providers**: stelle sicher, dass *Email* aktiv ist und *Confirm email* deaktiviert (interner Tool-Workflow).
2. **Authentication → URL Configuration**: trage `https://inside.talent-one.de` als Site-URL ein (oder zusätzlich zur bestehenden).
3. **Authentication → Users → Add user**: ersten Mitarbeiter mit E-Mail + Passwort anlegen.

## 3. Code aufs VPS

```bash
# auf dem VPS
cd /root
git clone git@github.com:halloheidi/talentone-inside.git
cd talentone-inside
```

## 4. Secrets eintragen

`/root/talentone-inside/backend/.env.local`:

```
SUPABASE_URL=https://fhvkbnbjnorsmsvrjizl.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key aus Supabase Dashboard → Settings → API>
ALLOWED_ORIGINS=https://inside.talent-one.de
PORT=3001
```

`/root/talentone-inside/.env` (für docker-compose Build-Args):

```
VITE_SUPABASE_URL=https://fhvkbnbjnorsmsvrjizl.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZodmtibmJqbm9yc21zdnJqaXpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwNTkxMTksImV4cCI6MjA5MDYzNTExOX0.Me-mGgDne3N9UadHPbv3ubAIlihG4fkVizvQ94k4Emw
```

## 5. Traefik-Netzwerk-Name prüfen

```bash
docker network ls | grep -E "traefik|proxy"
```

Heißt das Netz nicht `traefik`, in `docker-compose.yml` umbenennen (3× `networks: traefik` und 2× `traefik.docker.network=traefik`).

## 6. Compose starten

Variante A — als eigenständiges Compose:

```bash
cd /root/talentone-inside
docker compose up -d --build --force-recreate
docker compose logs -f
```

Variante B — in das bestehende Stack-Compose einhängen: die beiden Services aus `docker-compose.yml` übernehmen, das `networks:` block am Ende mergen.

## 7. Verifizieren

```bash
curl -I https://inside.talent-one.de              # 200, HTML
curl https://inside.talent-one.de/api/health      # {"status":"ok",...}
```

Browser auf `https://inside.talent-one.de` → Login-Maske → Anmeldung mit dem in Schritt 2 angelegten User → Dashboard mit leerer Kundenliste.

## Updates

```bash
cd /root/talentone-inside
git pull
docker compose up -d --build --force-recreate
```

> **Wichtig — `--force-recreate` nicht weglassen.** `docker compose up -d --build`
> baut zwar neue Images, schaltet die *laufenden* Container hier aber nicht
> zuverlässig auf das neue Image um (Container hängt am alten Image-ID, Uptime
> läuft weiter). Ohne `--force-recreate` bleibt ein Code-Deploy dann *leise
> wirkungslos*. Kontrolle nach dem Deploy:
>
> ```bash
> docker ps --filter name=talentone-inside   # Uptime muss frisch (Sekunden) sein
> curl -sI https://inside.talent-one.de | head -1          # HTTP/2 200
> curl -s  https://inside.talent-one.de/api/health         # {"status":"ok",...}
> ```
