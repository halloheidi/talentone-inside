# Reel-Modul für TalentOne Inside – Spezifikation v1.1

Stand: 18.11.2026 (v1.1 mit Abschnitt 8 „Ergänzungen nach Review", die Abschnitt 0–7 überschreiben, wo sie abweichen). Ziel: Recruiting-Reels im B-Roll-Format (animierte Bild-zu-Video-Clips + Erzählerstimme + Wort-für-Wort-Typografie + Endkarte) direkt aus dem Inside-Tool erzeugen, in drei bestätigten Schritten. Vorlage ist die manuelle Pipeline, mit der die Reels für Wilhelm GmbH Baudekoration (17.11.2026) entstanden sind.

## 0. Rahmen

- Neuer Reiter **„Reel"** am Projekt (Stelle), neben Adcopies/Funnel/Creatives.
- Drei Schritte, jeder mit Freigabe-Knopf: **1 Skript & Motive → 2 Bilder → 3 Video**. Nichts läuft ohne Klick, Kosten werden vor jedem kostenpflichtigen Schritt angezeigt.
- Mehrere Stellen eines Kunden können ein gemeinsames Reel bekommen (Satz 4 „Ob du lieber … oder …"); Auswahl der Stellen beim Anlegen.
- Stilwahl beim Anlegen: **Foto** (Standard), **Illustration** (flach, 2D), **3D-Animation** (Pixar-artig). Der Stil ändert nur den Stilblock in den Bild-Prompts, die restliche Pipeline bleibt gleich.
- Einwilligungssperre: echte Mitarbeiterfotos dürfen nur als Referenz dienen, wenn das Gating aus Creatives V2 erfüllt ist (siehe Abschnitt 8). Sonst Hinweis und Option „Person erfinden".

## 1. Datenmodell

```sql
create table talentone_reels (
  id uuid primary key default gen_random_uuid(),
  kunde_id uuid not null references talentone_kunden(id),
  job_ids uuid[] not null,
  projekt_id uuid,
  stil text not null default 'foto',            -- foto | illustration | 3d
  anrede text not null default 'du',            -- du | sie
  stimme text not null default 'dylan',         -- dylan (du) | harrison (sie) | ...
  status text not null default 'entwurf',       -- entwurf | skript_ok | bilder_ok | rendert | fertig | fehler
  skript jsonb,          -- [{nr, text, zeilen:[..], schluesselwoerter:[..], motiv_nr, dauer_s}]
  master_prompt text,
  motive jsonb,          -- [{nr, titel, prompt, bewegung, referenz_ids[], bild_url, bild_quelle (ki|upload|referenz), volle_breite, freigegeben}]
  referenzen jsonb,      -- {person: referenzbild_id|null, logo_url, fahrzeug: referenzbild_id|null, gebaeude: referenzbild_id|null}
  audio jsonb,           -- {voice_url, dauer_s, worttimings:[{w,start,end}], musik_url}
  clips jsonb,           -- [{motiv_nr, job_id, url, dauer_s, status, credits}]
  endkarte jsonb,        -- {titel, untertitel, button, farbe_hg, farbe_text}
  video_url text,
  kosten jsonb,          -- {openai_usd, higgsfield_credits, elevenlabs_credits, gesamt_credits}
  fehler text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by text
);

create table talentone_reel_kosten_log (
  id bigserial primary key,
  reel_id uuid references talentone_reels(id),
  schritt text,           -- bild | voice | clip | render
  anbieter text,          -- openai | higgsfield | elevenlabs | render
  menge numeric,          -- Sekunden, Bilder …
  credits numeric,
  usd numeric,
  request_id text,
  created_at timestamptz default now()
);
```

Keys (`HIGGSFIELD_API_KEY`, `ELEVENLABS_API_KEY`) in `.env.local`; einziger Settings-Wert: `reel_credit_warnschwelle` (z. B. 200).

Fertiges Video zusätzlich als Zeile in `talentone_creatives` (typ `video`, format `story`, quelle `reel`, `kosten_credits`, `roh_video_url` = Video ohne Typografie, falls erzeugt).

## 2. Schritt 1 – Skript & Motive

**Eingaben** aus dem Projekt: Firmenname, Ort, Branche, Anredeform, Farben, Logo; pro Stelle: Titel, Region, Benefits, Besonderheiten (Unterschied, Klima, Aufgaben, Kenntnisse), Quereinsteiger; freigegebene Mitarbeiterstimmen; Gehalt nur, wenn im Reel-Dialog explizit angehakt (Standard: aus).

**Aufruf** eines Sprachmodells (bestehender OpenAI-Zugang oder Anthropic) mit festem System-Prompt, Ausgabe als JSON. Vorgaben im System-Prompt:

- 9 Sätze + Schlusssatz „Link in der Anzeige. Eine Minute, fertig." (bei Sie: „Link in der Anzeige. Dauert keine Minute.").
- Jeder Satz 6 bis 14 Wörter, gesprochen 3 bis 7 Sekunden; gesamt 40 bis 48 Sekunden.
- Satz 1 = konkreter Hook aus dem Alltag (Uhrzeit, Ort, Firmenwagen o. ä.), Satz 2 = „Wir sind [Firma], [Gewerk] in [Ort]" plus stärkstes Firmenmerkmal (Gründungsjahr, Generation), Sätze 3–8 = Aufgaben und Benefits in Alltagssprache, Satz 9 = Zielgruppe ansprechen („Wir suchen …, die …").
- Mehrere Stellen: ein Satz der Form „Ob du lieber A … oder B …: Bei uns geht beides."
- Liegt eine freigegebene Mitarbeiterstimme vor: bevorzugt in Satz 7 als echtes Zitat, gekürzt auf 8–12 gesprochene Wörter, ohne Namen, als gesprochener Satz.
- Keine Floskeln („dynamisches Team"), keine Gehaltszahlen ohne Freigabe, keine Versprechen, die nicht in Benefits/Besonderheiten stehen.
- Pro Satz: Aufteilung in 2–3 Typografie-Zeilen und 0–2 markierte Schlüsselwörter (für die Marker-Schrift).
- Pro Satz ein Motiv: Titel, Bildprompt (2–3 Sätze: Ort, Tätigkeit, Kameraposition, Licht), Bewegungsnotiz für die Animation, benötigte Referenzen (person, fahrzeug, logo, gebaeude), Flag „volle Breite" bei Gruppenmotiven.
- Master-Prompt nach dem Muster unten, mit den Firmendaten gefüllt.

**UI:** Tabelle Satz | Text (editierbar) | Motiv-Titel | Motiv-Prompt (aufklappbar). Knöpfe „Neu vorschlagen", „Satz neu formulieren", „Freigeben". Rechts eine Vorschau der verfügbaren Referenzbilder des Kunden zum Zuordnen (Person, Fahrzeug, Gebäude). Fehlt eine Referenz (z. B. Gebäude), Hinweis „Foto hochladen oder Motiv anpassen".

**Master-Prompt-Vorlage** (Platzhalter in eckigen Klammern):

> Ich erstelle eine Bildserie für ein Recruiting-Video eines [Gewerk]-Betriebs in [Ort]. Halte dich bei allen folgenden Bildern an diese Regeln:
> Person: Der [Berufsbezeichnung] ist immer der Mann/die Frau aus dem Referenzfoto. Gleiches Gesicht, gleiche Statur, gleicher Bart, gleiche Frisur. Keine Variation von Bild zu Bild. [ohne Mitarbeiterfoto: Ich erzeuge die Person im ersten Schritt, danach gilt dieses Bild als Referenz.]
> Kleidung: [Arbeitskleidung laut Referenz], auf der linken Brust klein das Logo.
> Logo: Das Logo aus der PNG-Datei exakt übernehmen: [Kurzbeschreibung]. Nicht neu zeichnen, nicht verändern, keine Buchstaben hinzufügen oder ändern.
> Fahrzeug: [Fahrzeug laut Referenz], Kennzeichen unscharf, keine lesbare Telefonnummer.
> [Gebäude: exakt das Gebäude aus dem Referenzfoto, nur Perspektive und Licht dürfen abweichen.]
> Stil: [Foto: Fotorealistisch, wie mit einem iPhone aufgenommen, natürliches Licht, Reportage-Optik, keine Werbeästhetik. | Illustration: Flache, moderne Vektor-Illustration, klare Formen, wenige Farben, Firmenfarben als Akzent, gleicher Zeichenstil in allen Bildern. | 3D: Hochwertiger 3D-Animationslook wie ein Pixar-Film, weiches Licht, freundliche Proportionen, gleicher Charakter in allen Bildern.]
> Format: Hochformat 2:3 (bzw. 9:16, wenn der Bildendpunkt das direkt kann). Hauptmotiv mittig, seitlich Luft.
> Nicht im Bild: Kein Text außer Logo und Fahrzeugbeschriftung, keine Schilder, keine Wasserzeichen, keine Grafikelemente.
> Bewegung: Personen mitten in einer Tätigkeit, nicht posierend in die Kamera.

## 3. Schritt 2 – Bilder

- Pro Motiv ein Aufruf des OpenAI-Bildendpunkts (Bild-Edit mit Referenzen: Personenfoto, Logo-PNG, Fahrzeug, ggf. Gebäude, ggf. das bereits erzeugte Motiv 0 als Personenreferenz), über den bestehenden Pfad aus `imagegen.js`. Prompt = Master-Prompt + Motiv-Prompt. Größe 1024×1536, Qualität hoch.
- Ohne Mitarbeiterfoto zuerst **Motiv 0 „Referenzperson"** erzeugen; das Ergebnis wird Referenz für alle weiteren.
- UI: Raster 3×3, pro Kachel „Neu erzeugen", „Eigenes Bild hochladen", „Aus Referenzbildern wählen" (dann wird das echte Foto animiert, ohne KI-Bild). Häkchen „freigegeben" pro Kachel; Schritt 3 erst, wenn alle Motive ein Bild haben.
- Automatische Prüfhinweise (optional, später): Gesichtsabgleich zwischen Motiven, Textdetektion im Bild.
- Nach Freigabe: Bilder auf 1080×1920 bringen. Hochformate mittig beschneiden; Motive mit Flag „volle Breite" stattdessen einpassen und oben/unten mit unscharfem Rand füllen (Code in `reel-render-referenz.md`).
- Kosten: ca. 0,15–0,25 USD pro Bild (hohe Qualität), ins Kosten-Log.

## 4. Schritt 3 – Video (R2)

Reihenfolge und Anbieter:

1. **Stimme**: ElevenLabs (v4) mit Preset-Stimme je Anrede (Du: „Dylan", Sie: „Harrison"), stability 0.3, similarity 0.8, Regieanweisungen in eckigen Klammern pro Satz (ruhig / stolz / sachlich / warm / kurz). Bevorzugt direkt über ElevenLabs mit `with-timestamps` (liefert Worttimings mit); Dauer prüfen (Ziel ≤ 48 s).
2. **Worttimings**: aus dem ElevenLabs-Alignment. Fallback Whisper (`whisper-1`, `timestamp_granularities=word`, de) mit Fuzzy-Match gegen das Skript; Abweichungen im UI gelb markieren, kein Abbruch. Firmenname und Ort in die Fix-Liste.
3. **Clips**: pro Motiv Bild-zu-Video über die Higgsfield-Entwickler-API, Modell Seedance 2.0 Mini (falls nicht verfügbar: Wan 3.0, sonst Seedance 2.0), 720p, 9:16, Audio aus. Dauer = Satzdauer + `CLIP_PAD_S`, mind. `CLIP_MIN_S`; bei jedem Clip die ersten `CLIP_HEAD_TRIM_S` abschneiden (Standbild-Anlauf). Timeout `CLIP_TIMEOUT_MIN` mit automatischem Retry. Prompt = Bewegungsnotiz + „Realistic handheld documentary footage, face/clothing/logo consistent with the start frame, no text" (bei Illustration/3D: „consistent illustration style").
4. **Musik**: aus dem Pool `talentone-reel-musik` (handwerk / buero / neutral), Auswahl im UI, 0 Credits.
5. **Render** als Hintergrund-Job im Backend-Container (Job-Muster wie `animate.js`), eigenes Arbeitsverzeichnis pro Job. Ablauf wie `render2.sh` aus der Wilhelm-Produktion:
   - Clips trimmen auf Satzlänge, 24 fps, 1080×1920, Concat.
   - Kinetik-Typografie als ASS aus dem Skript-JSON: Blöcke zu 2–3 Zeilen, Wörter erscheinen zum Wortstart mit kurzem Pop (70→100 % in 110 ms), Montserrat ExtraBold 94 pt weiß mit dunkler Kontur, Schlüsselwörter in Permanent Marker 116 pt, Position zentriert bei y = 1230.
   - Endkarte `ENDCARD_S`: Hintergrund Firmenfarbe, Logo auf weißem Panel, Stellentitel, Region, Button „Jetzt bewerben", Unterzeile „Link in der Anzeige · dauert keine Minute"; letzter Satz läuft als Typografie über der Endkarte.
   - Audio: Stimme `VOICE_GAIN_DB`, Musik `MUSIC_GAIN_DB` mit Fade-in 1 s / Fade-out 2,5 s, Ziel `TARGET_LUFS`.
   - Ausgabe H.264 CRF 18, AAC 192 kbit/s, faststart; Decoder-Check (`ffmpeg -f null`) vor Upload.
   - Rückgabe: Video-URL (Supabase Storage), Dauer, 6 Prüf-Thumbnails für die Vorschau im Tool.
6. **Ablage**: `talentone_reels.video_url`, Zeile in `talentone_creatives`, Kosten-Log abschließen.

UI Schritt 3: Vorab-Schätzung („ca. 55 Credits + 1,80 USD Bilder"), Fortschritt pro Teilschritt, danach Player, Thumbnails, Knöpfe „Clip X neu generieren" (nur dieser Clip, Rest aus Cache), „Nur neu schneiden" (0 Credits, z. B. nach Textänderung), „Musik tauschen".

## 5. Credits-Anzeige

- Oben im Reiter: **Higgsfield-Guthaben** live über die API (Endpoint prüfen; falls keiner existiert: monatliches Budget minus Summe aus Kosten-Log), **verbraucht diesen Monat**, **Schätzung für dieses Reel**.
- Warnfarbe unter `reel_credit_warnschwelle`; unter Schätzwert kein Start möglich.
- Pro Kunde Auswertung „Reel-Kosten" aus dem Kosten-Log für die Weiterberechnung.

## 6. Offene Punkte (vor R2 zu klären, Bericht aus R1)

1. Higgsfield-Entwickler-API: Welche Video-Modelle (Seedance 2.0 Mini? Wan 3.0? Kling 3.0?) zu welchem Preis pro Sekunde (Preisseite nennt Seedance 2.0 0,080 USD/s, Wan 3.0 0,038 USD/s, Kling 3.0 0,071 USD/s; Seedance Mini nicht gelistet). Gibt es einen Guthaben-Endpoint? Gibt es ElevenLabs-Stimme über Higgsfield oder braucht es den direkten ElevenLabs-Key?
2. Musik-Pool befüllen (10 lizenzierte Instrumentals, ohne langes Intro, bei 45 s ausblendbar).

## 7. Referenz: fertige Produktion Wilhelm (17.11.2026)

Skript 9 Sätze + Schluss, 42 s Stimme, 9 Clips Seedance 2.0 Mini (4–8 s), Musik ElevenLabs, Gesamt ca. 65 Credits inkl. Testclips und Nachbesserung; Render-Skripte und Erfahrungswerte in `reel-render-referenz.md` (im Projekt: `claude/reel-render-skripte.md`).

## 8. Ergänzungen nach Review (18.11.2026)

Festlegungen des Entwicklungs-Chats und Ergänzungen daraus; sie gelten vor den Abschnitten oben.

- **Wiederverwenden statt neu bauen:** `higgsfield.js` (Seedance Submit/Poll), `reel-ffmpeg.js` (Overlay-Pipeline), `animate.js` (Job-Muster), OpenAI-Bildpfad aus `imagegen.js`, `freigegebene-stimmen.js` als Skript-Input, Migration 115.
- **Einwilligungslogik wie in Creatives V2:** `kunde_freigabe`, `ki_verarbeitung_erlaubt`, `personen_zustimmung`, `keine_ki_bilder`, zusätzlich `ki_personen_informiert_am`.
- **Keys in `.env.local`** (`HIGGSFIELD_API_KEY` ist dort schon vorgesehen), nicht in `talentone_settings`. Einziger Settings-Wert: `reel_credit_warnschwelle`.
- **Kein externer Render-Dienst.** Render als Hintergrund-Job im Backend-Container (ffmpeg 8.1.3 vorhanden); Python3, Pillow, faster-whisper-Abhängigkeiten und die Fonts Montserrat ExtraBold + Permanent Marker schon in R1 ins Dockerfile. Jeder Job im eigenen Arbeitsverzeichnis; nie zwei Prozesse auf dieselbe Ausgabedatei (einzige Fehlerquelle in der manuellen Produktion).
- **Musik aus Pool**, nicht generiert: Bucket `talentone-reel-musik`, Ordner `handwerk/`, `buero/`, `neutral/`.
- **Etappen:** R1 = Tabellen, Reiter, Anlegen, Schritt 1 und 2, Kosten-Log, Schritt 3 als deaktivierter Button „Video (kommt in R2)". R2 = Stimme, Timings, Clips, Render, Endkarte, Credits-Anzeige, nach dem Modell-/Preisbericht.
- **Konstanten in `reel-config.js`:** `CLIP_HEAD_TRIM_S = 0.4`, `CLIP_PAD_S = 1.4`, `CLIP_MIN_S = 4`, `VOICE_GAIN_DB = 3.5`, `MUSIC_GAIN_DB = -17.5`, `TARGET_LUFS = -17`, `CLIP_TIMEOUT_MIN = 8`, `ENDCARD_S = 6.5`.
- **Worttimings:** bei direkter ElevenLabs-Anbindung `text-to-speech/{voice_id}/with-timestamps` nutzen; Whisper nur als Fallback (Fuzzy-Match, gelbe Markierung, kein Abbruch).
- **Typografie generisch:** Zeilen und Schlüsselwörter kommen aus dem Skript-JSON, nicht hartcodiert wie in `subs.py`.
- **Verifikation R1:** Bei Wilhelm steht `personen_zustimmung` bei beiden Fotos auf false und `ki_personen_informiert_am` ist leer; der Positivtest braucht vorher die Freigabe im Tool (Mitarbeiter-OK liegt vor) oder läuft mit Tuskulum (`ki_personen_informiert_am` seit 3.11.2026 gesetzt). Negativtest (Sperre + „Person erfinden") mit Klimapartner von der Heidt.
