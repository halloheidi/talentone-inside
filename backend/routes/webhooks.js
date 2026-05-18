// Webhook-Endpoints — KEIN Login. Optional Secret-Validierung über ?secret=.

import { Router } from 'express';
import { supabase } from '../supabase.js';

const router = Router();

const KNOWN_CONTACT_KEYS = new Set([
  'name', 'full_name', 'fullname', 'vorname', 'nachname',
  'first_name', 'firstname', 'last_name', 'lastname',
  'email', 'e-mail', 'mail',
  'telefon', 'phone', 'tel', 'telephone', 'mobile', 'handynummer',
]);

function extractContact(body) {
  if (!body || typeof body !== 'object') return { name: null, email: null, telefon: null, rest: {} };

  // Normalisiere Keys auf lowercase für Lookup
  const lookup = {};
  for (const [k, v] of Object.entries(body)) lookup[k.toLowerCase()] = v;

  const vorname = lookup.vorname || lookup.first_name || lookup.firstname || '';
  const nachname = lookup.nachname || lookup.last_name || lookup.lastname || '';
  const combined = (vorname + ' ' + nachname).trim();
  const name = (lookup.full_name || lookup.fullname || lookup.name || combined || null) || null;
  const email = lookup.email || lookup['e-mail'] || lookup.mail || null;
  const telefon = lookup.telefon || lookup.phone || lookup.tel || lookup.telephone || lookup.mobile || lookup.handynummer || null;

  const rest = {};
  for (const [k, v] of Object.entries(body)) {
    if (!KNOWN_CONTACT_KEYS.has(k.toLowerCase())) rest[k] = v;
  }
  return {
    name: name?.toString().trim() || null,
    email: email?.toString().trim() || null,
    telefon: telefon?.toString().trim() || null,
    rest,
  };
}

function restToAntworten(rest) {
  return Object.entries(rest).map(([k, v]) => ({
    frage_text: k,
    antwort: typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? ''),
  }));
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
    const antworten = restToAntworten(contact.rest);

    const { data: bew, error: insErr } = await supabase
      .from('talentone_bewerbungen')
      .insert({
        funnel_id: funnel?.id || null,
        job_id: job.id,
        name: contact.name,
        email: contact.email,
        telefon: contact.telefon,
        antworten,
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

export default router;
