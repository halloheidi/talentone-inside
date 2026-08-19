// Webhook-Endpoints — KEIN Login. Optional Secret-Validierung über ?secret=.
// easybill-Webhook läuft in einem separaten Router (routes/easybill-webhook.js),
// damit er den Raw-Body für HMAC-Signatur-Verifikation vor dem globalen
// express.json() erhält.

import { Router } from 'express';
import { supabase } from '../supabase.js';
import { extractStelle } from '../sheets-mapping.js';

const router = Router();

// Meta-Felder von Perspective, die wir komplett ignorieren
const META_KEYS = new Set([
  'id', 'funnelid', 'funnelname', 'meta', 'values', 'titles',
  'trackingversion', 'profile', 'createdat', 'updatedat',
]);

// Flache Kontakt-Keys (für Fallback bei nicht-Perspective-Webhooks)
const FLAT_CONTACT_KEYS = new Set([
  'name', 'full_name', 'fullname', 'vorname', 'nachname',
  'first_name', 'firstname', 'last_name', 'lastname',
  'email', 'e-mail', 'mail',
  'telefon', 'phone', 'tel', 'telephone', 'mobile', 'handynummer',
]);

function pickValue(node) {
  if (node == null) return null;
  if (typeof node === 'object') {
    if ('value' in node && typeof node.value !== 'object') return node.value;
    return null;
  }
  return node;
}

/**
 * onepage.io schickt POST body {type:'lead.created', data:{fields:[{step,label,value,fieldType},...]}}.
 * Wir extrahieren Kontakt-Felder aus fieldType und Detail-Felder ueber
 * ein Mapping auf step/label-Text. Alles Nicht-Zuordenbare landet unter
 * "step -> label" als Key im daten-jsonb — nichts wird verworfen.
 * Der ORIGINAL-Payload wird immer zusaetzlich als daten._raw abgelegt.
 */
function extractOnepage(body) {
  const fields = body?.data?.fields;
  if (!Array.isArray(fields) || fields.length === 0) return null;

  const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

  // step-basiertes Mapping (Fragetext -> Ziel-Feldname)
  const stepMap = [
    { re: /fläche haben/i,            target: 'Flächenart' },
    { re: /groß.*freifläche|freifläche.*groß|wie groß/i, target: 'Größe der Fläche' },
    { re: /wofür.*genutzt|aktuelle.*nutzung/i,           target: 'Aktuelle Flächennutzung' },
    { re: /eigentümer.*fläche/i,      target: 'Eigentümer der Fläche' },
    { re: /plz.*ort|adresse.*fläche/i, target: 'Standort Freifläche' },
    { re: /weitere flächeninfor/i,    target: 'Flächeninformationen' },
  ];
  // label-basiertes Mapping (falls step generisch wie "2-Minuten-Flächen-Check")
  const labelMap = [
    { re: /beste erreichbar/i,        target: 'Beste Erreichbarkeit' },
    { re: /nachricht.*uns/i,          target: 'Anmerkung' },
  ];

  let vorname = null, nachname = null, email = null, telefon = null;
  const daten = {};
  let groesseValue = null;

  for (const f of fields) {
    const ftype = norm(f.fieldType);
    const step  = String(f.step  || '').trim();
    const label = String(f.label || '').trim();
    const val   = f.value == null ? '' : String(f.value).trim();
    if (!val) continue;  // Leere Antworten uebersprungen

    // Kontakt-Felder per fieldType
    if (ftype === 'fname')     { vorname  = val; continue; }
    if (ftype === 'lname')     { nachname = val; continue; }
    if (ftype === 'email')     { email    = val; continue; }
    if (ftype === 'phone' || ftype === 'tel' || ftype === 'telephone' || ftype === 'mobile') {
      telefon = val; continue;
    }

    // step-Mapping zuerst
    let target = null;
    for (const m of stepMap) if (m.re.test(step)) { target = m.target; break; }
    // Falls step nicht griff: label
    if (!target) {
      for (const m of labelMap) if (m.re.test(label)) { target = m.target; break; }
    }
    // Fallback: konservativer Freiform-Key
    if (!target) target = label || step || 'Antwort';

    // Bei Groesse den Wert merken fuer Projektname-Auto-Generierung
    if (target === 'Größe der Fläche') {
      // Einheit an den Wert haengen (label kann "Hektar" oder "m²" sein).
      const einheit = /hektar|ha\b/i.test(label) ? ' ha'
                    : /m²|qm|m2/i.test(label)     ? ' m²'
                    : label && !/^(auswähl|select)/i.test(label) ? ` ${label}` : '';
      const displayVal = `${val}${einheit}`;
      daten[target] = displayVal;
      groesseValue = displayVal;
      continue;
    }

    daten[target] = val;
  }

  const name = [vorname, nachname].filter(Boolean).join(' ').trim() || null;

  // Auto-generierter Projektname: "[Nachname] - [Größe]" (Airtable-Muster)
  if (nachname && groesseValue && !daten['Projektname']) {
    daten['Projektname'] = `${nachname} - ${groesseValue}`;
  }

  // Roh-Payload immer mitspeichern — nichts geht verloren.
  daten._raw = body;

  return { name, email, telefon, daten };
}

// Onepage-Wert flach machen: strings direkt; Select-Arrays [{_id,value}] ->
// "a, b"; Name-Objekt {firstName,middleName,lastName} -> "Vor Nach"; {value:x} -> x.
function flattenOnepageValue(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(flattenOnepageValue).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    if ('value' in v) return flattenOnepageValue(v.value);
    const nm = [v.firstName, v.middleName, v.lastName].filter(Boolean).join(' ').trim();
    if (nm) return nm;
    return '';
  }
  return String(v).trim();
}

/**
 * onepage.io-Format (data.fields[]) -> selbe Kontakt-Struktur wie extractContact:
 * { name, email, telefon, antworten:[{frage_text, antwort}] }. Kontakt via
 * fieldType (form-name/form-email/form-phone-number, auch legacy-Kurzformen).
 * Echte Frage steht in `step` (label ist generisch wie "Select"). Datei-Uploads
 * werden ignoriert. Gibt null zurueck, wenn es kein data.fields-Payload ist.
 */
export function extractOnepageContact(body) {
  const fields = body?.data?.fields;
  if (!Array.isArray(fields)) return null;

  const norm = s => String(s || '').toLowerCase().trim();
  let vorname = null, nachname = null, fullName = null, email = null, telefon = null;
  const antworten = [];

  for (const f of fields) {
    const ftype = norm(f.fieldType);
    const label = String(f.label || '').trim();
    const step  = String(f.step  || '').trim();
    const val   = flattenOnepageValue(f.value);

    // Kontakt-Felder (onepage: form-*; plus legacy-Kurzformen).
    if (ftype === 'form-name' || ftype === 'name' || ftype === 'fullname') { if (val) fullName = val; continue; }
    if (ftype === 'fname' || ftype === 'firstname') { if (val) vorname = val; continue; }
    if (ftype === 'lname' || ftype === 'lastname')  { if (val) nachname = val; continue; }
    if (ftype === 'form-email' || ftype === 'email') { if (val) email = val; continue; }
    if (ftype === 'form-phone-number' || ftype === 'form-phone' || ['phone', 'tel', 'telephone', 'mobile'].includes(ftype)) {
      if (val) telefon = val; continue;
    }
    if (ftype === 'form-uploader' || ftype === 'uploader' || ftype === 'form-file') continue; // Datei -> ignorieren
    // Kontakt ohne bekannten fieldType: nur bei eindeutigem Label.
    if (!email && /^e-?mail$/.test(norm(label))) { if (val) { email = val; continue; } }
    if (!telefon && /^(telefon|telefonnummer|handy|mobil|rufnummer)$/.test(norm(label))) { if (val) { telefon = val; continue; } }
    if (!val) continue;
    // Frage = step (echte Funnel-Frage), Fallback label.
    antworten.push({ frage_text: step || label || 'Antwort', antwort: val });
  }

  const name = fullName || [vorname, nachname].filter(Boolean).join(' ').trim() || null;
  return { name, email, telefon, antworten };
}

export function extractContact(body) {
  if (!body || typeof body !== 'object') {
    return { name: null, email: null, telefon: null, antworten: [] };
  }

  const profile = (body.profile && typeof body.profile === 'object') ? body.profile : {};
  const values  = (body.values  && typeof body.values  === 'object') ? body.values  : {};

  const flat = {};
  for (const [k, v] of Object.entries(body)) flat[k.toLowerCase()] = v;

  const nameParts = [pickValue(profile.first_name), pickValue(profile.last_name)].filter(Boolean).join(' ').trim();
  const valuesNameParts = [values.first_name, values.last_name].filter(Boolean).join(' ').trim();
  const name =
    pickValue(profile.name) ||
    pickValue(profile.fullName) ||
    pickValue(profile.full_name) ||
    values.name || values.fullName || values.full_name ||
    nameParts || valuesNameParts ||
    flat.name || flat.full_name || flat.fullname ||
    [flat.vorname || flat.first_name || flat.firstname, flat.nachname || flat.last_name || flat.lastname]
      .filter(Boolean).join(' ').trim() ||
    null;

  const email =
    pickValue(profile.email) ||
    values.email ||
    flat.email || flat['e-mail'] || flat.mail ||
    null;

  const telefon =
    pickValue(profile.phone) ||
    pickValue(profile.telefon) ||
    values.phone || values.telefon ||
    flat.telefon || flat.phone || flat.tel || flat.telephone || flat.mobile || flat.handynummer ||
    null;

  // Antworten aus dem Profil — jede Funnel-Frage ist ein { title, value }-Objekt.
  // Manche Funnels nutzen "question_xyz"-Keys, andere semantische Keys
  // (ausbildung, fuehrerschein, startzeitpunkt …). Deshalb NICHT auf "question_"
  // filtern, sondern ALLE Profil-Felder mit Wert nehmen AUSSER Kontakt- und
  // Meta-/Tracking-Feldern (utm_*, ps_*, fbclid, …).
  const KONTAKT_PROFILE = new Set(['email', 'phone', 'telefon', 'tel', 'mobile', 'name', 'fullname', 'full_name', 'first_name', 'firstname', 'vorname', 'last_name', 'lastname', 'nachname']);
  const istMetaKey = (k) => /^(utm_|ps_|fb|ga_|gclid|gad|wbraid|gbraid)/i.test(k)
    || ['fbclid', 'gclid', 'id', 'trackingversion'].includes(String(k).toLowerCase());
  const antworten = [];
  for (const [k, v] of Object.entries(profile)) {
    if (!v || typeof v !== 'object' || !('value' in v)) continue;
    if (KONTAKT_PROFILE.has(String(k).toLowerCase()) || istMetaKey(k)) continue;
    // Echte Funnel-Fragen tragen IMMER einen title/label. Ohne title sind es
    // Meta-Felder (z. B. "result": "Danke") — die lassen wir weg.
    const frage = v.title || v.label;
    if (!frage) continue;
    const antwort = v.value;
    if (antwort == null || antwort === '') continue;
    antworten.push({
      frage_text: String(frage).trim(),
      antwort: typeof antwort === 'object' ? JSON.stringify(antwort) : String(antwort).trim(),
    });
  }

  // Fallback: nicht-Perspective-Webhook (flaches JSON) — alte Logik
  if (antworten.length === 0 && Object.keys(profile).length === 0) {
    for (const [k, v] of Object.entries(body)) {
      const lk = k.toLowerCase();
      if (FLAT_CONTACT_KEYS.has(lk) || META_KEYS.has(lk)) continue;
      antworten.push({
        frage_text: k,
        antwort: typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? ''),
      });
    }
  }

  return {
    name: name ? String(name).trim() || null : null,
    email: email ? String(email).trim() || null : null,
    telefon: telefon ? String(telefon).trim() || null : null,
    antworten,
  };
}

/* Findet den Ziel-Job anhand des Multi-Stellen-Mappings (Antwort enthält Text →
   job_id). Case-insensitiver Teilstring-Match über alle Antwort-Werte. */
function matchJobFromMapping(mapping, antworten) {
  const regeln = Array.isArray(mapping?.regeln) ? mapping.regeln : [];
  const items = (antworten || []).map(a => ({ a, hay: String(a?.antwort ?? '').toLowerCase() }));
  for (const r of regeln) {
    const needle = String(r?.enthaelt ?? '').trim().toLowerCase();
    if (!needle || !r?.job_id) continue;
    const treffer = items.find(({ hay }) => hay.includes(needle));
    if (treffer) return { job_id: r.job_id, antwortText: treffer.a?.antwort ?? null };
  }
  return { job_id: null, antwortText: null };
}

/* POST /api/webhooks/perspective?job_id=<uuid>  ODER  ?kunde_id=<uuid>  (&secret=<optional>)
   Body: beliebiges JSON von Perspective.co — wir extrahieren Name/Mail/Telefon,
   Rest landet in antworten. Bei kunde_id: ein Funnel bedient mehrere Stellen;
   die Bewerbung wird per Stellen-Mapping dem richtigen Job zugeordnet. */
// Fragen eines Funnels (fragen[] bevorzugt, sonst screens[type=question]).
function funnelQuestions(funnel) {
  if (!funnel) return [];
  const fragen = Array.isArray(funnel.fragen) ? funnel.fragen : [];
  if (fragen.length) return fragen;
  const screens = Array.isArray(funnel.screens) ? funnel.screens : [];
  return screens.filter(s => s && s.type === 'question');
}

/**
 * KO-Bewertung anhand der Funnel-Fragen: markiert je Antwort, ob die gewählte
 * Option als KO (options[].ko === true) hinterlegt ist. Liefert die (ggf. mit
 * `ko:true` angereicherten) Antworten + ein Gesamt-Flag.
 * @returns {{ antworten: Array, ko: boolean }}
 */
export function evaluateKoKriterium(antworten, funnel) {
  const questions = funnelQuestions(funnel);
  const norm = s => String(s || '').trim().toLowerCase();
  let ko = false;
  const marked = (Array.isArray(antworten) ? antworten : []).map(a => {
    if (!questions.length) return a;
    const q = questions.find(q => norm(q.text) === norm(a.frage_text));
    const opt = q && Array.isArray(q.options) ? q.options.find(o => norm(o.text) === norm(a.antwort)) : null;
    if (opt?.ko === true) { ko = true; return { ...a, ko: true }; }
    return a;
  });
  return { antworten: marked, ko };
}

/**
 * Legt eine Bewerbung an UND löst denselben Downstream aus wie der reguläre
 * Perspective-Pfad (Sheets-Sync, Kunden-Mail bzw. interne Warn-Mail bei unklarer
 * Zuordnung). Gemeinsam genutzt von /perspective UND vom /leads-Perspective-Zweig
 * — kein duplizierter Versand-/Sync-Code.
 */
async function insertBewerbungUndBenachrichtige({ contact, job, funnel, zuordnungUnklar = false, warnAntwort = null, rawBody = null }) {
  const { antworten: markedAntworten, ko } = evaluateKoKriterium(contact.antworten, funnel);

  const { data: bew, error: insErr } = await supabase
    .from('talentone_bewerbungen')
    .insert({
      funnel_id: funnel?.id || null,
      job_id: job?.id || null,
      name: contact.name,
      email: contact.email,
      telefon: contact.telefon,
      antworten: markedAntworten,
      stelle_gewaehlt: extractStelle(contact.antworten),
      quelle: 'perspective',
      ko_kriterium: ko,
      zuordnung_unklar: zuordnungUnklar,
      raw: rawBody ?? null,
    })
    .select().single();
  if (insErr) throw new Error(insErr.message);

  // Nachgelagert (best-effort): Google-Sheets-Sync + Mails. Blockiert nie.
  (async () => {
    try {
      const kunde = job?.kunde_id
        ? (await supabase.from('talentone_kunden').select('*').eq('id', job.kunde_id).maybeSingle()).data
        : null;

      const { syncBewerbungToSheet } = await import('../sheets-sync.js');
      await syncBewerbungToSheet({ bewerbung: bew, job, kunde });

      const sheetsCfg = kunde?.sheets_sync;
      const sheetUrl = (sheetsCfg?.enabled && sheetsCfg?.spreadsheet_id)
        ? `https://docs.google.com/spreadsheets/d/${sheetsCfg.spreadsheet_id}/edit`
        : (funnel?.extern_sheet_url || null);

      if (zuordnungUnklar) {
        const { sendBewerbungUnzugeordnetWarnung } = await import('../mail.js');
        await sendBewerbungUnzugeordnetWarnung({ kunde, job, antwortText: warnAntwort, alleAntworten: contact.antworten });
      } else if (kunde?.email) {
        const { sendBewerbungsMail } = await import('../exports.js');
        await sendBewerbungsMail({ kunde, job, bewerbung: { ...bew, quelle: 'perspective' }, sheetUrl });
      }
    } catch (err) { console.warn('[bewerbung-downstream]', err.message); }
  })().catch(err => console.error('[bewerbung-downstream-uncaught]', err.message));

  return bew;
}

// Legt eine Kundenanfrage an (talentone_anfragen) + benachrichtigt Best-Effort
// (Portal-Accounts mit benachrichtige_leads, sonst Kunden-Haupt-Mail). Wird aus
// dem Ingest-Handler für neukundengewinnungs-Jobs aufgerufen.
async function createAnfrageUndBenachrichtige({ job, body }) {
  // Zuerst onepage.io-Format probieren (data.fields[]), sonst Perspective/flat.
  const onepage = extractOnepage(body);
  let name, email, telefon, daten;
  if (onepage) {
    ({ name, email, telefon, daten } = onepage);
    console.log(`[webhooks/ingest] onepage.io Anfrage — name=${name} email=${email} felder=${Object.keys(daten).length}`);
  } else {
    const contact = extractContact(body);
    const restDaten = {};
    for (const [k, v] of Object.entries(body || {})) {
      const lk = String(k).toLowerCase();
      if (META_KEYS.has(lk) || FLAT_CONTACT_KEYS.has(lk)) continue;
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') restDaten[k] = v;
      else if (v && typeof v === 'object') restDaten[k] = v;
    }
    if (Object.keys(restDaten).length === 0 && contact.antworten?.length) {
      for (const a of contact.antworten) restDaten[a.frage || 'antwort'] = a.antwort;
    }
    // Auch hier Roh-Payload speichern, damit nichts verloren geht.
    restDaten._raw = body;
    name = contact.name; email = contact.email; telefon = contact.telefon; daten = restDaten;
  }

  const { data: anfrage, error: insErr } = await supabase
    .from('talentone_anfragen').insert({
      job_id: job.id,
      name, email, telefon, daten,
      quelle:  'webhook',
      status:  'neu',
    }).select().single();
  if (insErr) throw new Error(insErr.message);

  // Best-Effort-Mail: alle aktiven Portal-Accounts mit benachrichtige_leads=true
  // + Kunden-Haupt-Mail als Fallback, plus INTERNAL_BCC. Blockt niemals die Response.
  (async () => {
    try {
      const { data: kunde } = await supabase
        .from('talentone_kunden').select('*').eq('id', job.kunde_id).maybeSingle();
      if (!kunde) return;

      const { data: accounts = [] } = await supabase.from('talentone_portal_accounts')
        .select('email, benachrichtige_leads, aktiv')
        .eq('kunde_id', kunde.id)
        .eq('aktiv', true)
        .eq('benachrichtige_leads', true);
      const emails = new Set(accounts.map(a => (a.email || '').trim().toLowerCase()).filter(Boolean));

      // Kunden-Haupt-Mail nur als Fallback wenn keine Portal-Accounts benachrichtigt werden
      // sollen — verhindert doppelte Zustellung.
      if (emails.size === 0 && kunde.email) emails.add(kunde.email.trim().toLowerCase());

      const recipients = Array.from(emails);
      if (recipients.length === 0) {
        console.log(`[anfrage-mail] kein Empfaenger fuer kunde=${kunde.id.slice(0,8)} — Mail skipped`);
        return;
      }

      const { sendAnfrageMail } = await import('../mail.js');
      const { getPublicBaseUrl } = await import('../branding.js');
      const anfragenUrl = job.anfragen_token
        ? `${getPublicBaseUrl(kunde.agentur)}/anfragen/${job.anfragen_token}`
        : null;
      await sendAnfrageMail({ to: recipients, kunde, job, anfrage, anfragenUrl });
      console.log(`[anfrage-mail] ${recipients.length} Empfaenger benachrichtigt (${recipients.join(', ')}) + INTERNAL_BCC`);
    } catch (err) { console.warn('[anfrage-mail]', err.message); }
  })().catch(err => console.error('[anfrage-mail-uncaught]', err.message));

  return anfrage;
}

/*
 * Einheitlicher Ingest-Endpunkt für Funnel-/Landingpage-Einreichungen.
 *
 * Routing-Quelle ist das DATENMODELL (talentone_jobs.projekttyp), NICHT die URL:
 *   projekttyp='neukundengewinnung' → Kundenanfrage (talentone_anfragen)
 *   sonst (mitarbeitergewinnung/…)  → Bewerbung (talentone_bewerbungen)
 * Die URL-Wahl ist bewusst keine Semantik mehr: /ingest, /perspective und /leads
 * sind Aliasse auf denselben Handler (kein Verhaltensunterschied). So kann die
 * falsche URL im Funnel-Builder (Kries-Vorfall) keine Fehl-Einordnung mehr
 * verursachen.
 *
 * Zusätzliche Absicherung: Perspective-Payloads (funnelId) werden erkannt und
 * gegen talentone_funnels.perspective_funnel_id aufgelöst. Bei Konflikt zwischen
 * funnelId-Match und ?job_id gewinnt der funnelId-Match (Warn-Log) — und ein
 * Perspective-Payload ist immer eine Bewerbung.
 *
 * Kein stiller Drop: unbekannter/fehlender Job + erkennbarer Bewerbungs-Payload
 * → Bewerbung mit zuordnung_unklar=true.
 */
async function ingestHandler(req, res) {
  const { job_id, kunde_id, secret } = req.query || {};

  // IMMER roh loggen — auch bei Ablehnung. Damit "kam nichts an" nie wieder
  // Raetselraten ist. Content-Type verraet Body-Parser-Probleme (leerer Body).
  const bodyKeys = req.body && typeof req.body === 'object' ? Object.keys(req.body) : [];
  console.log(`[webhooks/ingest] IN path=${req.path} ct=${req.headers['content-type'] || '-'} query=${JSON.stringify(req.query || {})} bodyKeys=[${bodyKeys.join(',')}] raw=${JSON.stringify(req.body ?? null).slice(0, 4000)}`);

  // Secret: jedes konfigurierte Webhook-Secret wird akzeptiert (Alias-kompatibel:
  // Perspective- ODER Leads-Secret). Ist keins gesetzt, ist der Endpunkt offen.
  const secrets = [process.env.PERSPECTIVE_WEBHOOK_SECRET, process.env.LEADS_WEBHOOK_SECRET].filter(Boolean);
  if (secrets.length && !secrets.includes(secret)) {
    console.warn('[webhooks/ingest] 401 invalid secret');
    return res.status(401).json({ error: 'invalid secret' });
  }

  const b = req.body || {};
  try {
    // Kontakt/Antworten extrahieren (Format-erkennend: onepage vs Perspective/flat).
    const isOnepage = Array.isArray(b?.data?.fields);
    const contact = (isOnepage ? extractOnepageContact(b) : extractContact(b))
      || { name: null, email: null, telefon: null, antworten: [] };

    // Perspective-Payload + funnelId-Match (Absicherung, hat Vorrang vor ?job_id).
    const pFunnelId = b.funnelId || b._raw?.funnelId || null;
    let funnel = null;
    if (pFunnelId) {
      const { data } = await supabase.from('talentone_funnels').select('*')
        .eq('perspective_funnel_id', String(pFunnelId))
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      funnel = data || null;
    }

    // ── kunde_id-Pfad (Multi-Stellen-Funnel): immer Bewerbung, Job per Mapping ──
    if (kunde_id) {
      if (!contact.email && !contact.telefon) {
        console.warn(`[webhooks/ingest] SKIP no_contact (kunde_id=${kunde_id}) name=${contact.name || '-'} antworten=${contact.antworten?.length || 0}`);
        return res.status(200).json({ ok: true, skipped: 'no_contact' });
      }
      const { data: kunde } = await supabase.from('talentone_kunden')
        .select('id, funnel_stellen_mapping').eq('id', kunde_id).maybeSingle();
      if (!kunde) return res.status(404).json({ error: 'Kunde nicht gefunden.' });
      const { data: kJobs } = await supabase.from('talentone_jobs')
        .select('id, stelle, kunde_id, created_at')
        .eq('kunde_id', kunde.id).order('created_at', { ascending: true });
      if (!kJobs?.length) return res.status(404).json({ error: 'Kunde hat keine Stellen.' });
      const jobById = Object.fromEntries(kJobs.map(j => [j.id, j]));
      const mapping = kunde.funnel_stellen_mapping || {};
      const match = matchJobFromMapping(mapping, contact.antworten);
      let job, zuordnungUnklar = false, warnAntwort = null;
      if (match.job_id && jobById[match.job_id]) {
        job = jobById[match.job_id];
      } else if (mapping.default_job_id && jobById[mapping.default_job_id]) {
        job = jobById[mapping.default_job_id];
      } else if (kJobs.length === 1) {
        // Nur EINE Stelle beim Kunden → eindeutig, KEINE Warnung. (Jobs haben kein
        // Aktiv-Flag → "aktive Jobs" = die Jobs des Kunden; Multi-Stellen-Mapping
        // greift ohnehin nur bei mehreren.) Häufig, wenn der Funnel nur den Standort
        // abfragt, nicht die Stelle — die Standort-Antwort steckt in `antworten` und
        // wird regulär mitgespeichert/verschickt. Normale Kunden-Benachrichtigung.
        job = kJobs[0];
      } else {
        // Mehrere Stellen zur Auswahl, aber keine Stellen-Antwort erkennbar → vorläufig
        // ältesten Job, als "unklar" markieren + interne Warn-Mail. Nichts geht verloren.
        job = kJobs[0];
        zuordnungUnklar = true;
        warnAntwort = contact.antworten.map(a => a.antwort).filter(Boolean).join(' | ') || null;
      }
      // Funnel für KO-Bewertung: funnelId-Match bevorzugt, sonst über job_id.
      let koFunnel = funnel;
      if (!koFunnel) {
        koFunnel = (await supabase.from('talentone_funnels').select('*')
          .eq('job_id', job.id).order('created_at', { ascending: false }).limit(1).maybeSingle()).data || null;
      }
      const bew = await insertBewerbungUndBenachrichtige({ contact, job, funnel: koFunnel, zuordnungUnklar, warnAntwort, rawBody: b });
      return res.status(201).json({ ok: true, routed: 'bewerbung', bewerbung_id: bew.id, job_id: job.id, zuordnung_unklar: zuordnungUnklar });
    }

    // ── Job bestimmen: funnelId-Match hat Vorrang vor ?job_id (bei Konflikt Warn) ──
    const jobIdFromFunnel = funnel?.job_id || null;
    if (jobIdFromFunnel && job_id && String(jobIdFromFunnel) !== String(job_id)) {
      console.warn(`[webhooks/ingest] Konflikt: funnelId-Match Job ${jobIdFromFunnel} ≠ ?job_id ${job_id} — funnelId gewinnt.`);
    }
    const effectiveJobId = jobIdFromFunnel || job_id || null;
    let job = null;
    if (effectiveJobId) {
      job = (await supabase.from('talentone_jobs').select('*').eq('id', effectiveJobId).maybeSingle()).data || null;
    }

    // Erkennbarer Bewerbungs-Payload? (Perspective-Shape oder echte Antworten)
    const looksBewerbung = !!(pFunnelId || b.profile || b.values || (contact.antworten && contact.antworten.length));

    // ── Kein Job auflösbar → nie stiller Drop ──
    if (!job) {
      if ((contact.email || contact.telefon) && looksBewerbung) {
        const bew = await insertBewerbungUndBenachrichtige({
          contact, job: null, funnel,
          zuordnungUnklar: true,
          warnAntwort: contact.antworten.map(a => a.antwort).filter(Boolean).join(' | ') || null,
          rawBody: b,
        });
        console.warn(`[webhooks/ingest] kein Job (job_id=${job_id || '-'} funnelId=${pFunnelId || '-'}) → Bewerbung ${bew.id} zuordnung_unklar=true`);
        return res.status(201).json({ ok: true, routed: 'bewerbung', bewerbung_id: bew.id, zuordnung_unklar: true });
      }
      // Keine Bewerbung + kein Job → Anfrage braucht job_id (NOT NULL). Log + 200 (kein Retry).
      console.warn(`[webhooks/ingest] kein Job und kein Bewerbungs-Payload — nichts angelegt (job_id=${job_id || '-'}).`);
      return res.status(200).json({ ok: true, skipped: 'no_job' });
    }

    // ── Routing per projekttyp; Perspective-Payload erzwingt Bewerbung ──
    const istNeukunden = job.projekttyp === 'neukundengewinnung';
    const alsBewerbung = pFunnelId ? true : !istNeukunden;

    if (alsBewerbung) {
      if (!contact.email && !contact.telefon) {
        console.warn(`[webhooks/ingest] SKIP no_contact (job=${job.id}) name=${contact.name || '-'} antworten=${contact.antworten?.length || 0}`);
        return res.status(200).json({ ok: true, skipped: 'no_contact' });
      }
      // Funnel für KO: funnelId-Match bevorzugt, sonst über job_id.
      let koFunnel = funnel;
      if (!koFunnel) {
        koFunnel = (await supabase.from('talentone_funnels').select('*')
          .eq('job_id', job.id).order('created_at', { ascending: false }).limit(1).maybeSingle()).data || null;
      }
      // Perspective-Payload, aber funnelId nicht gematcht → Zuordnung unsicher.
      const unklar = !!pFunnelId && !funnel;
      const bew = await insertBewerbungUndBenachrichtige({ contact, job, funnel: koFunnel, zuordnungUnklar: unklar, warnAntwort: null, rawBody: b });
      return res.status(201).json({ ok: true, routed: 'bewerbung', bewerbung_id: bew.id, job_id: job.id, zuordnung_unklar: unklar });
    }

    // ── Kundenanfrage (neukundengewinnung) ──
    const anfrage = await createAnfrageUndBenachrichtige({ job, body: b });
    return res.status(201).json({ ok: true, routed: 'anfrage', anfrage_id: anfrage.id, job_id: job.id });
  } catch (err) {
    console.error('[webhooks/ingest]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// Neuer Standard-Endpunkt für alle Funnel-/Landingpage-Einreichungen.
router.post('/ingest', ingestHandler);
// Aliasse — Alt-URLs zeigen auf denselben Handler, damit bestehende Einträge in
// Perspective/Onepage nicht brechen. Kein Verhaltensunterschied mehr.
router.post('/perspective', ingestHandler);
router.post('/leads', ingestHandler);

export default router;
