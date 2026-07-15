// Webhook-Endpoints — KEIN Login. Optional Secret-Validierung über ?secret=.
// easybill-Webhook läuft in einem separaten Router (routes/easybill-webhook.js),
// damit er den Raw-Body für HMAC-Signatur-Verifikation vor dem globalen
// express.json() erhält.

import { Router } from 'express';
import { supabase } from '../supabase.js';

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

function extractContact(body) {
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

  // Antworten aus profile.question_* — Jeder Key hat { title, value }
  const antworten = [];
  for (const [k, v] of Object.entries(profile)) {
    if (!k.startsWith('question_')) continue;
    if (!v || typeof v !== 'object') continue;
    const frage = v.title || v.label || k;
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

/* POST /api/webhooks/perspective?job_id=<uuid>&secret=<optional>
   Body: beliebiges JSON von Perspective.co — wir extrahieren Name/Mail/Telefon,
   Rest landet in antworten. */
router.post('/perspective', async (req, res) => {
  const { job_id, secret } = req.query || {};
  if (!job_id) return res.status(400).json({ error: 'job_id query param fehlt.' });

  const requiredSecret = process.env.PERSPECTIVE_WEBHOOK_SECRET;
  if (requiredSecret && secret !== requiredSecret) {
    return res.status(401).json({ error: 'invalid secret' });
  }

  try {
    const { data: job, error: jE } = await supabase
      .from('talentone_jobs').select('*').eq('id', job_id).maybeSingle();
    if (jE || !job) return res.status(404).json({ error: 'Job nicht gefunden.' });

    const { data: funnel } = await supabase
      .from('talentone_funnels').select('*')
      .eq('job_id', job.id).order('created_at', { ascending: false }).limit(1).maybeSingle();

    const contact = extractContact(req.body);

    // Unvollstaendige Bewerbungen ausfiltern: wenn WEDER E-Mail NOCH Telefon
    // vorliegt, hat der Interessent das Kontaktformular am Ende nicht
    // ausgefuellt. Solche Datensaetze wollen wir NICHT im Kunden-Postfach
    // sehen. 200 OK statt 400, damit Perspective nicht retryt.
    if (!contact.email && !contact.telefon) {
      console.log(`[perspective] Bewerbung ohne Kontaktdaten verworfen (job ${job.id.slice(0,8)})`);
      return res.status(200).json({ ok: true, skipped: 'no_contact' });
    }

    const { data: bew, error: insErr } = await supabase
      .from('talentone_bewerbungen')
      .insert({
        funnel_id: funnel?.id || null,
        job_id: job.id,
        name: contact.name,
        email: contact.email,
        telefon: contact.telefon,
        antworten: contact.antworten,
        quelle: 'perspective',
        ko_kriterium: false,
      })
      .select().single();
    if (insErr) return res.status(500).json({ error: insErr.message });

    // Mail an Kunden (best-effort)
    (async () => {
      try {
        const { data: kunde } = await supabase
          .from('talentone_kunden').select('*').eq('id', job.kunde_id).maybeSingle();
        if (!kunde?.email) return;
        const { sendBewerbungsMail } = await import('../exports.js');
        await sendBewerbungsMail({
          kunde, job,
          bewerbung: { ...bew, quelle: 'perspective' },
          sheetUrl: funnel?.extern_sheet_url || null,
        });
      } catch (err) { console.warn('[perspective-mail]', err.message); }
    })().catch(err => console.error('[perspective-mail-uncaught]', err.message));

    res.status(201).json({ ok: true, bewerbung_id: bew.id });
  } catch (err) {
    console.error('[webhooks/perspective]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* POST /api/webhooks/leads?job_id=<uuid>&secret=<optional>
   Nimmt Kundenanfragen aus externen Landingpage-Buildern (onepage.io u. Ä.)
   entgegen. Kontaktdaten werden extrahiert (Name/Mail/Telefon), alle
   weiteren Felder landen in `daten` (jsonb). Anschließend Best-Effort-Mail
   an den Kunden. */
router.post('/leads', async (req, res) => {
  const { job_id, secret } = req.query || {};
  if (!job_id) return res.status(400).json({ error: 'job_id query param fehlt.' });

  const requiredSecret = process.env.LEADS_WEBHOOK_SECRET;
  if (requiredSecret && secret !== requiredSecret) {
    return res.status(401).json({ error: 'invalid secret' });
  }

  try {
    const { data: job, error: jE } = await supabase
      .from('talentone_jobs').select('*').eq('id', job_id).maybeSingle();
    if (jE || !job) return res.status(404).json({ error: 'Job nicht gefunden.' });

    // Zuerst onepage.io-Format probieren (data.fields[]), sonst Perspective/flat.
    const onepage = extractOnepage(req.body);
    let name, email, telefon, daten;
    if (onepage) {
      ({ name, email, telefon, daten } = onepage);
      console.log(`[webhooks/leads] onepage.io Payload erkannt — name=${name} email=${email} felder=${Object.keys(daten).length}`);
    } else {
      const contact = extractContact(req.body);
      const restDaten = {};
      for (const [k, v] of Object.entries(req.body || {})) {
        const lk = String(k).toLowerCase();
        if (META_KEYS.has(lk) || FLAT_CONTACT_KEYS.has(lk)) continue;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') restDaten[k] = v;
        else if (v && typeof v === 'object') restDaten[k] = v;
      }
      if (Object.keys(restDaten).length === 0 && contact.antworten?.length) {
        for (const a of contact.antworten) restDaten[a.frage || 'antwort'] = a.antwort;
      }
      // Auch hier Roh-Payload speichern, damit nichts verloren geht.
      restDaten._raw = req.body;
      name = contact.name; email = contact.email; telefon = contact.telefon; daten = restDaten;
    }

    const { data: anfrage, error: insErr } = await supabase
      .from('talentone_anfragen').insert({
        job_id: job.id,
        name, email, telefon, daten,
        quelle:  'webhook',
        status:  'neu',
      }).select().single();
    if (insErr) return res.status(500).json({ error: insErr.message });

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
        // sollen — verhindert doppelte Zustellung wenn der Kunde die Haupt-Adresse
        // auch als Portal-Account angelegt hat.
        if (emails.size === 0 && kunde.email) emails.add(kunde.email.trim().toLowerCase());

        const recipients = Array.from(emails);
        if (recipients.length === 0) {
          console.log(`[leads-mail] kein Empfaenger fuer kunde=${kunde.id.slice(0,8)} — Mail skipped`);
          return;
        }

        const { sendAnfrageMail } = await import('../mail.js');
        const { getPublicBaseUrl } = await import('../branding.js');
        const anfragenUrl = job.anfragen_token
          ? `${getPublicBaseUrl(kunde.agentur)}/anfragen/${job.anfragen_token}`
          : null;
        await sendAnfrageMail({ to: recipients, kunde, job, anfrage, anfragenUrl });
        console.log(`[leads-mail] ${recipients.length} Empfaenger benachrichtigt (${recipients.join(', ')}) + INTERNAL_BCC`);
      } catch (err) { console.warn('[leads-mail]', err.message); }
    })().catch(err => console.error('[leads-mail-uncaught]', err.message));

    res.status(201).json({ ok: true, anfrage_id: anfrage.id });
  } catch (err) {
    console.error('[webhooks/leads]', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
