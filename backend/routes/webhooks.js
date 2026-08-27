// Webhook-Endpoints — KEIN Login. Optional Secret-Validierung über ?secret=.
// easybill-Webhook läuft in einem separaten Router (routes/easybill-webhook.js),
// damit er den Raw-Body für HMAC-Signatur-Verifikation vor dem globalen
// express.json() erhält.

import { Router } from 'express';
import { supabase } from '../supabase.js';
import { extractStelle } from '../sheets-mapping.js';
import { extractAnhaenge, spiegeleAnhaenge, anhaengeMitSignedUrls } from '../anhaenge.js';

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

/* Normalisiert Job-/Antwort-Texte für den Fuzzy-Vergleich: Kleinschreibung,
   (m/w/d)-Zusätze + Sonderzeichen raus, Whitespace kollabiert. */
function normJobText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\(\s*[mwd](?:\s*\/\s*[mwd])*\s*\)/g, ' ') // (m/w/d), (w/m/d), (m/w) …
    .replace(/[^a-z0-9äöüß]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
// Signifikante Tokens (≥4 Zeichen) — filtert Füllwörter wie „und", „der" heraus.
function signifikanteTokens(s) {
  return normJobText(s).split(' ').filter(w => w.length >= 4);
}

/* Ordnet eine Bewerbung ohne explizite Stellen-Antwort einem Job zu, indem die
   Antwort-Werte gegen die Job-Titel gematcht werden (normalisierter Substring in
   eine Richtung ODER gemeinsame signifikante Tokens; z. B. „Bauhelfer (m/w/d)"
   ↔ „Pflasterer / Bauhelfer"). Nur ein EINDEUTIGER Treffer zählt — bei
   mehreren/keinem Treffer null (dann greift der unklar-Fallback). */
export function fuzzyMatchJob(jobs, antworten) {
  const answerTexts = (antworten || []).map(a => a?.antwort).filter(Boolean).map(String);
  if (!answerTexts.length) return null;
  const answerNorms = answerTexts.map(normJobText).filter(Boolean);
  const answerTokens = new Set(answerTexts.flatMap(signifikanteTokens));
  const treffer = [];
  for (const j of (jobs || [])) {
    const jn = normJobText(j?.stelle);
    if (!jn) continue;
    let hit = answerNorms.some(an => an && (jn.includes(an) || an.includes(jn)));
    if (!hit) hit = signifikanteTokens(j?.stelle).some(t => answerTokens.has(t));
    if (hit) treffer.push(j);
  }
  return treffer.length === 1 ? treffer[0] : null;
}

// Projekttypen, die KEINE echten Bewerbungs-Ziele sind — sie dürfen die Job-Zählung
// im Multi-Stellen-Match nicht verfälschen (Vorfall Schüßler: Pseudo-Job "Video"
// machte den Ein-Stellen-Kunden zum Mehr-Stellen-Fall → Fehlwarnungen).
const NICHT_RECRUITING_TYPEN = new Set(['neukundengewinnung', 'video', 'sonstiges']);
export function istRecruitingJob(job) {
  // null/undefined/'mitarbeitergewinnung' = Recruiting; alles andere ausgeschlossen.
  return !NICHT_RECRUITING_TYPEN.has(job?.projekttyp);
}

/* Zentrale Job-Zuordnung für den kunde_id-Pfad (Multi-Stellen-Funnel).
   Reihenfolge: explizite Mapping-Regel → Ein-Job-Kurzschluss → Fuzzy-Match gegen
   Job-Titel → expliziter Default-Job → unklar-Fallback (ältester Job + Warn-Mail).
   Gezählt werden NUR echte Bewerbungs-Ziele (istRecruitingJob) — Video-/Sonstiges-/
   Neukunden-Projekte bleiben außen vor. Ein-Job-Kunden werden NIE als unklar markiert. */
export function resolveKundeJob(kJobs, mapping, antworten) {
  const alle = Array.isArray(kJobs) ? kJobs : [];
  // Nur Recruiting-Jobs zählen; falls dadurch nichts übrig bliebe (Kunde hat NUR
  // Nicht-Recruiting-Projekte), auf die volle Liste zurückfallen → nie stiller Drop.
  const recruiting = alle.filter(istRecruitingJob);
  const jobs = recruiting.length ? recruiting : alle;
  const jobById = Object.fromEntries(jobs.map(j => [j.id, j]));
  const map = mapping || {};

  const match = matchJobFromMapping(map, antworten);
  if (match.job_id && jobById[match.job_id]) {
    return { job: jobById[match.job_id], zuordnungUnklar: false, warnAntwort: null };
  }
  // Ein-Job-Kurzschluss: genau eine Stelle → immer eindeutig, keine Warnung
  // (z. B. Funnel fragt nur Standort/Qualifikation ab; die Antwort steckt in
  // `antworten` und wird regulär mitgeführt).
  if (jobs.length === 1) {
    return { job: jobs[0], zuordnungUnklar: false, warnAntwort: null };
  }
  // Mehr-Job-Kunden: Fuzzy-Match gegen die Job-Titel, bevor gewarnt wird.
  const fuzzy = fuzzyMatchJob(jobs, antworten);
  if (fuzzy) {
    return { job: fuzzy, zuordnungUnklar: false, warnAntwort: null };
  }
  // Expliziter Default-Job aus dem Mapping (Admin-Wahl, keine Warnung).
  if (map.default_job_id && jobById[map.default_job_id]) {
    return { job: jobById[map.default_job_id], zuordnungUnklar: false, warnAntwort: null };
  }
  // Erst jetzt ist die Warnung berechtigt: mehrere Stellen, keine Zuordnung möglich.
  const warnAntwort = (antworten || []).map(a => a.antwort).filter(Boolean).join(' | ') || null;
  return { job: jobs[0] || null, zuordnungUnklar: true, warnAntwort };
}

/* Identifiziert den Kunden aus dem Payload (Funnel-Titel/-Name) per Namens-Match
   gegen talentone_kunden.firmenname — der längste enthaltene Firmenname gewinnt
   (z. B. funnelName "AZMET GmbH - Bauhelfer (m/w/d)" → Kunde "AZMET GmbH"). */
async function identifiziereKundeAusPayload(body) {
  const name = String(body?.funnelName || body?.funnel_name || body?._raw?.funnelName || body?.data?.funnelName || '')
    .toLowerCase().trim();
  if (!name) return null;
  const { data: kunden } = await supabase.from('talentone_kunden')
    .select('id, firmenname, funnel_stellen_mapping');
  let best = null;
  for (const k of kunden || []) {
    const fn = String(k.firmenname || '').trim().toLowerCase();
    if (fn.length < 3) continue;
    if (name.includes(fn) && (!best || fn.length > best._len)) best = { ...k, _len: fn.length };
  }
  return best;
}

/* Fallback-Zuordnung, wenn weder ?job_id/?kunde_id noch ein funnelId-Match einen
   Job liefern: Kunde aus dem Payload erkennen und dieselbe resolveKundeJob-Logik
   (Ein-Job-Kurzschluss + Fuzzy-Match) anwenden. Der Funnel-Titel wird als
   synthetische Antwort eingespeist, damit der Fuzzy-Match die Stelle darin sieht.
   Gibt { job, zuordnungUnklar, warnAntwort, kunde } oder null zurück. */
export async function resolveJobViaKundePayload(body, antworten) {
  const kunde = await identifiziereKundeAusPayload(body);
  if (!kunde) return null;
  const { data: kJobs } = await supabase.from('talentone_jobs')
    .select('id, stelle, kunde_id, created_at, projekttyp')
    .eq('kunde_id', kunde.id).order('created_at', { ascending: true });
  if (!kJobs?.length) return null;
  const funnelName = body?.funnelName || body?.funnel_name || body?._raw?.funnelName || body?.data?.funnelName || null;
  const matchAntworten = funnelName
    ? [...(antworten || []), { frage_text: 'Funnel', antwort: String(funnelName) }]
    : (antworten || []);
  const r = resolveKundeJob(kJobs, kunde.funnel_stellen_mapping || {}, matchAntworten);
  return { ...r, kunde };
}

/* Selbstheilung: registriert eine (bislang unbekannte) Perspective-funnelId als
   neue Funnel-Zeile, verknüpft mit dem aufgelösten Job — damit künftige Webhooks
   direkt per perspective_funnel_id matchen. Idempotent + best-effort. */
async function registriereFunnelSelbstheilung(pFunnelId, job) {
  if (!pFunnelId || !job?.id) return;
  try {
    const { data: exists } = await supabase.from('talentone_funnels')
      .select('id').eq('perspective_funnel_id', String(pFunnelId)).limit(1).maybeSingle();
    if (exists) return;
    await supabase.from('talentone_funnels').insert({
      job_id: job.id,
      funnel_typ: 'perspective',
      extern: true,
      perspective_funnel_id: String(pFunnelId),
      veroeffentlicht: true,
      fragen: [],
      bilder: {},
    });
    console.log(`[webhooks/ingest] Selbstheilung: funnelId ${pFunnelId} → neue Funnel-Zeile für Job ${job.id} registriert.`);
  } catch (e) {
    console.warn('[webhooks/ingest] Selbstheilung fehlgeschlagen:', e.message);
  }
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
  // Dublettenbremse: identischer Doppel-Submit (gleiche E-Mail + gleicher Job,
  // Eingang innerhalb weniger Minuten) → bestehende Bewerbung zurückgeben statt
  // neu anzulegen/erneut zu benachrichtigen.
  if (job?.id && contact.email) {
    const seit = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: dupe } = await supabase.from('talentone_bewerbungen')
      .select('id, created_at')
      .eq('job_id', job.id).eq('email', contact.email)
      .gte('created_at', seit)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (dupe) {
      console.log(`[bewerbung] Dublette übersprungen — email=${contact.email} job=${job.id} (bestehend ${dupe.id})`);
      return dupe;
    }
  }

  const { antworten: markedAntworten, ko } = evaluateKoKriterium(contact.antworten, funnel);
  // Datei-Anhänge (Lebenslauf o. Ä.) aus dem Roh-Payload erkennen — zunächst mit
  // Original-URLs speichern (nichts geht verloren), Spiegelung folgt nachgelagert.
  const anhaenge = extractAnhaenge(rawBody);

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
      anhaenge,
      raw: rawBody ?? null,
    })
    .select().single();
  if (insErr) throw new Error(insErr.message);

  // Nachgelagert (best-effort): Anhänge spiegeln + Google-Sheets-Sync + Mails. Blockiert nie.
  (async () => {
    try {
      // Anhänge in den privaten Bucket spiegeln (non-fatal je Datei) + Zeile aktualisieren.
      let anhaengeFinal = Array.isArray(bew.anhaenge) ? bew.anhaenge : [];
      if (anhaengeFinal.length) {
        const { anhaenge: gespiegelteAnhaenge, gespiegelt: nOk, tot } = await spiegeleAnhaenge(bew.id, anhaengeFinal);
        anhaengeFinal = gespiegelteAnhaenge;
        await supabase.from('talentone_bewerbungen').update({ anhaenge: gespiegelteAnhaenge }).eq('id', bew.id);
        console.log(`[anhaenge] Bewerbung ${bew.id}: ${nOk} gespiegelt, ${tot} tot`);
      }
      // Mail-Links länger gültig (Kunde öffnet evtl. später); Portal bleibt durable.
      const anhaengeLinks = await anhaengeMitSignedUrls(anhaengeFinal, { expiresIn: 60 * 60 * 24 * 30 });

      const kunde = job?.kunde_id
        ? (await supabase.from('talentone_kunden').select('*').eq('id', job.kunde_id).maybeSingle()).data
        : null;

      const { syncBewerbungToSheet } = await import('../sheets-sync.js');
      await syncBewerbungToSheet({ bewerbung: { ...bew, anhaenge: anhaengeFinal }, job, kunde });

      const sheetsCfg = kunde?.sheets_sync;
      const sheetUrl = (sheetsCfg?.enabled && sheetsCfg?.spreadsheet_id)
        ? `https://docs.google.com/spreadsheets/d/${sheetsCfg.spreadsheet_id}/edit`
        : (funnel?.extern_sheet_url || null);

      // Kunden-Benachrichtigung IMMER senden, wenn ein Kunde/Job vorhanden ist —
      // auch bei unklarer Zuordnung (mit dem vorläufig zugeordneten Job). Die
      // interne Warn-Mail ist ein ZUSATZ, kein Ersatz, sonst verschluckt eine
      // unklare Zuordnung die reguläre Bewerbungs-Mail an den Kunden.
      if (kunde?.email) {
        const { sendBewerbungsMail } = await import('../exports.js');
        await sendBewerbungsMail({ kunde, job, bewerbung: { ...bew, quelle: 'perspective' }, sheetUrl, anhaenge: anhaengeLinks });
      }
      if (zuordnungUnklar) {
        const { sendBewerbungUnzugeordnetWarnung } = await import('../mail.js');
        await sendBewerbungUnzugeordnetWarnung({ kunde, job, antwortText: warnAntwort, alleAntworten: contact.antworten });
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
        .select('id, stelle, kunde_id, created_at, projekttyp')
        .eq('kunde_id', kunde.id).order('created_at', { ascending: true });
      if (!kJobs?.length) return res.status(404).json({ error: 'Kunde hat keine Stellen.' });
      const mapping = kunde.funnel_stellen_mapping || {};
      // Zuordnung inkl. Ein-Job-Kurzschluss + Fuzzy-Match (siehe resolveKundeJob).
      const { job, zuordnungUnklar, warnAntwort } = resolveKundeJob(kJobs, mapping, contact.antworten);
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

    // ── Fallback vor "unklar": Kunde aus dem Payload identifizieren (Funnel-Titel)
    //    und resolveKundeJob anwenden (Ein-Job-Kurzschluss + Fuzzy). Nur wenn auch
    //    das scheitert, wird unklar gesetzt. Bei sicherem Treffer: Selbstheilung. ──
    let zuordnungUnklarOverride = null;
    let warnAntwortOverride = null;
    if (!job && (contact.email || contact.telefon) && looksBewerbung) {
      const via = await resolveJobViaKundePayload(b, contact.antworten);
      if (via?.job) {
        job = via.job;
        zuordnungUnklarOverride = via.zuordnungUnklar;
        warnAntwortOverride = via.warnAntwort;
        if (!via.zuordnungUnklar) {
          console.log(`[webhooks/ingest] Fallback-Treffer: Kunde "${via.kunde.firmenname}" → Job ${job.id} (${job.stelle}); pFunnelId=${pFunnelId || '-'}.`);
          await registriereFunnelSelbstheilung(pFunnelId, job); // damit künftige Matches direkt greifen
        } else {
          console.warn(`[webhooks/ingest] Fallback: Kunde "${via.kunde.firmenname}" erkannt, Stelle aber unklar → Job ${job.id} (vorläufig).`);
        }
      }
    }

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
      // Zuordnung unsicher? Override aus dem Kunde-Fallback hat Vorrang, sonst:
      // Perspective-Payload ohne funnelId-Match.
      const unklar = zuordnungUnklarOverride !== null ? zuordnungUnklarOverride : (!!pFunnelId && !funnel);
      const bew = await insertBewerbungUndBenachrichtige({ contact, job, funnel: koFunnel, zuordnungUnklar: unklar, warnAntwort: warnAntwortOverride, rawBody: b });
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
