# TalentOne Inside

Internes Kampagnen-Tool für TalentOne-Mitarbeiter — verwaltet Kunden, Stellen, Creatives, Ad Copies, Funnels, Angebote, Rechnungen und Controlling.

- **Frontend**: React + Vite + Supabase Auth — `/frontend`
- **Backend**: Node.js + Express + Supabase Service Role — `/backend`
- **DB**: Supabase `fhvkbnbjnorsmsvrjizl`, Tabellen mit Prefix `talentone_`
- **Production**: https://inside.talent-one.de (Traefik + Docker-Compose auf VPS 69.62.116.44)

## Lokale Entwicklung

### Backend

```bash
cd backend
cp .env.example .env.local   # Werte eintragen
npm install
npm run dev                  # http://localhost:3001
npm test                     # Unit-Tests (offer-calc, billing-rules, controlling-service, ...)
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

---

## Betrieb

### Scheduler-Übersicht

Fünf Scheduler laufen im Backend-Container. Alle starten mit dem Server, initial verzögert, danach zyklisch. Ohne `EASYBILL_API_KEY` starten sie nicht (Log-Warnung).

| Scheduler | Initial-Delay | Zyklus | Was er tut |
|-----------|---------------|--------|------------|
| **easybill-sync** (`easybill-sync.js`) | +30 s | stündlich | Vollsync der easybill-Kundenliste in `talentone_easybill_customers` (paginated, upsert per `easybill_id`) |
| **offer-sync** (`offer-sync.js`) | +45 s | alle 15 Min | Für jedes Angebot mit `status ∈ {created, sent}` und `easybill_document_id`: prüft in easybill über `ref_id` auf Nachfolge-Dokument (CHARGE_CONFIRM > INVOICE), setzt bei Fund `status='accepted'`, feuert Close-Notiz best-effort |
| **invoice-sync** (`invoice-sync.js`) | +90 s | alle 15 Min | Für offene `talentone_invoices`: prüft in easybill Zahlungsstatus (`is_paid`, `paid_at`); aktualisiert `campaign_payment_status` je Kunde (ok/pending/blocked, nur Anzeige) |
| **billing-cron** (`billing-scheduler.js`) | +2 Min, dann alle 60 Min | täglich 06:00 Berlin am `BILLING_TRIGGER_DAY` (Default 25.) | Monatlicher Rechnungslauf für den Folgemonat — respektiert Garantie-Regel (`billing-rules.js`): bill_full / bill_budget_only / skip_and_wait_first_hire / skip_manual_reactivation / skip_service_waived / skip_campaign_ended |
| **reminder** (`billing-reminder.js`) | +150 s, dann alle 60 Min | täglich 09:00 Berlin | Erinnerungsmail für überfällige `talentone_invoices` (Cooldown 5 Tage, Template `reminder_email` je Marke) |

### Manuelle Trigger-Endpoints

Alle erfordern Auth-Header (`Authorization: Bearer <supabase-access-token>`). Zum Debuggen genügt es, mit dem eigenen Login-Token einen POST zu senden.

| Endpoint | Zweck |
|----------|-------|
| `POST /api/easybill-customers/sync` | Kunden-Cache-Sync sofort — Rückgabe: `{ upserted, pages, duration_ms }` |
| `GET  /api/easybill-customers/sync/status` | Status des letzten Kundensyncs |
| `POST /api/offers/sync` | Alle offenen Angebote gegen easybill prüfen (Rücksync) |
| `POST /api/offers/:id/resync-easybill` | Einzelner Angebots-Rücksync |
| `GET  /api/offers/sync/status` | Status |
| `POST /api/invoices/sync` | Alle offenen Rechnungen gegen easybill prüfen + Kampagnen-Ampel |
| `POST /api/invoices/monthly/run-cron` | **Monatlicher Rechnungslauf sofort auslösen** (respektiert `BILLING_TRIGGER_DAY` — läuft nur an einem Trigger-Tag) |
| `POST /api/invoices/monthly/run-now` `{offer_id, period_start?}` | Rechnungslauf für **ein einzelnes Angebot** — ignoriert Trigger-Tag; nützlich für Ad-hoc-Rechnungen |
| `GET  /api/invoices/monthly/cron-status` | Status des letzten Rechnungslaufs |
| `POST /api/invoices/reminders/run` | Erinnerungsrunde sofort |
| `GET  /api/invoices/reminders/status` | Status |

### Env-Variablen (Auszug)

Volle Liste in `backend/.env.example`. Kritische Vars fürs Abrechnungs-System:

```
# easybill
EASYBILL_API_KEY=...                                  # Pflicht
EASYBILL_OFFER_TEMPLATE_TALENTONE=433187              # optional (default im Code)
EASYBILL_OFFER_TEMPLATE_NOWAG_WIRTH=305416            # optional
EASYBILL_INVOICE_TEMPLATE_TALENTONE=433193            # optional
EASYBILL_INVOICE_TEMPLATE_NOWAG_WIRTH=311656          # optional
EASYBILL_ORDER_TEMPLATE_TALENTONE=433190              # Auftragsbestätigung (CHARGE_CONFIRM)
EASYBILL_ORDER_TEMPLATE_NOWAG_WIRTH=311713

# easybill-Webhook (optional, aktuell nicht registriert)
EASYBILL_WEBHOOK_SECRET=<zufällig>                    # ohne diese Var antwortet /api/webhooks/easybill mit 403

# Abrechnungs-Cron
BILLING_TRIGGER_DAY=25                                # Stichtag im Monat (default 25 für Folgemonat)

# Interne Mail-BCC
INTERNAL_BCC=info@nowagwirth.de,andrea.saltaleggio@nowagwirth.de

# PayPal (optional pro Rechnung)
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_WEBHOOK_ID=...
```

### Wenn ein Rechnungslauf fehlgeschlagen ist

**Wichtig**: der monatliche Lauf ist **idempotent**. Wiederholung ist gefahrlos.

Idempotenz-Anker im Code:
- `talentone_invoices` hat pro Angebot + Periode nur maximal eine aktive Zeile (Duplikats-Guard `existing.period_start`)
- `talentone_billing_skip_log` hat `UNIQUE (offer_id, period_start)` — ein zweiter Lauf im selben Zeitraum ergibt `already_billed` oder `already_logged`
- Auch der Setup-Rechnungs-Endpunkt macht Dreifach-Dup-Check (interner Row, easybill über `ref_id`, Verlinkung statt Neu-Erzeugung)
- Der PayPal-Webhook prüft `paid`-Idempotenz (bereits `paid` + gleicher `paid_at` → nur `last_synced_at`)
- Der offer-sync-Kern (`computeTransitionPatch`) ist rein-funktional und dokumentiert dieses Verhalten in seinen Unit-Tests

**Vorgehen bei Fehlern**:

1. **Log-Check**: `docker exec talentone-inside-backend docker logs <container> --tail 200` — Fehler meldet der Cron unter `[billing-cron]` mit `offer_id`. Der Rest der Runde läuft weiter (der Fehler ist gefangen und geloggt).
2. **Einzeltrigger**: `POST /api/invoices/monthly/run-now { offer_id, period_start }` — läuft nur für dieses eine Angebot. Wenn easybill wieder erreichbar ist, erzeugt der Aufruf die Rechnung nachträglich; wenn sie schon existiert, kommt `already_billed` zurück.
3. **Bulk-Wiederholung**: `POST /api/invoices/monthly/run-cron` an einem Trigger-Tag (oder manuell nach VPS-Zeit-Setzen im Testfall).
4. **Kampagnen-Ampel**: `POST /api/invoices/sync` — läuft nur die Bewertung der Kunden-Zahlungsstati durch, keine Rechnungserzeugung.

---

## Datenbank

Alle Tabellen mit RLS aktiv; das Backend nutzt die Service-Role, das Frontend geht ausschließlich über die eigene `/api/*`-Schicht.

### Haupt-Tabellen (Auszug)
- `talentone_kunden` — Firmen
- `talentone_jobs` — Stellen pro Kunde
- `talentone_creatives` / `talentone_adcopies` / `talentone_funnels` — Kampagnen-Material
- `talentone_offer_products` / `talentone_offer_templates` — Positionskatalog + Textbausteine
- `talentone_offers` — Angebote (Status, Marke, Summen, Garantie-Felder)
- `talentone_invoices` — Rechnungen (Setup + monatlich)
- `talentone_hires` — Einstellungen je Angebot
- `talentone_billing_skip_log` — übersprungene / servicefreie Monatsläufe (Basis „Garantiekosten")
- `talentone_ad_budget_history` — TalentOne-Werbebudget-Änderungen
- `talentone_easybill_customers` — Kunden-Cache
- `talentone_brand_assets` — Flyer-Meta (Storage-Bucket `brand-assets`)

## Login-Verwaltung

Mitarbeiter werden im Supabase-Dashboard unter **Authentication → Users** angelegt. Rollen (`admin` / `team`) sind statisch in `backend/team.js` gepflegt — Admin sieht Controlling + Angebots-Katalog + Anhänge-Tab.
