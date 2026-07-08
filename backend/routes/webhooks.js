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

    const contact = extractContact(req.body);
    // Rest-Felder = alles außer den Kontakt-/Meta-Feldern in einem jsonb-Dump.
    const restDaten = {};
    for (const [k, v] of Object.entries(req.body || {})) {
      const lk = String(k).toLowerCase();
      if (META_KEYS.has(lk) || FLAT_CONTACT_KEYS.has(lk)) continue;
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        restDaten[k] = v;
      } else if (v && typeof v === 'object') {
        restDaten[k] = v;
      }
    }
    // Wenn kein Rest-Feld extrahierbar war: alle Perspective-artigen Antworten mitschreiben
    if (Object.keys(restDaten).length === 0 && contact.antworten?.length) {
      for (const a of contact.antworten) restDaten[a.frage || 'antwort'] = a.antwort;
    }

    const { data: anfrage, error: insErr } = await supabase
      .from('talentone_anfragen').insert({
        job_id: job.id,
        name:    contact.name,
        email:   contact.email,
        telefon: contact.telefon,
        daten:   restDaten,
        quelle:  'webhook',
        status:  'neu',
      }).select().single();
    if (insErr) return res.status(500).json({ error: insErr.message });

    // Best-Effort-Mail an den Kunden (blockt niemals die Response)
    (async () => {
      try {
        const { data: kunde } = await supabase
          .from('talentone_kunden').select('*').eq('id', job.kunde_id).maybeSingle();
        if (!kunde?.email) return;
        const { sendAnfrageMail } = await import('../mail.js');
        const { getPublicBaseUrl } = await import('../branding.js');
        const anfragenUrl = job.anfragen_token
          ? `${getPublicBaseUrl(kunde.agentur)}/anfragen/${job.anfragen_token}`
          : null;
        await sendAnfrageMail({ to: kunde.email, kunde, job, anfrage, anfragenUrl });
      } catch (err) { console.warn('[leads-mail]', err.message); }
    })().catch(err => console.error('[leads-mail-uncaught]', err.message));

    res.status(201).json({ ok: true, anfrage_id: anfrage.id });
  } catch (err) {
    console.error('[webhooks/leads]', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
