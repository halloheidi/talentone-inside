// Zugriff auf den lokalen easybill-Kunden-Cache + write-through nach easybill.
// Wird vom Angebots-Wizard Schritt 1 genutzt.
//
// Sicherheits-Modell: alle Endpoints hinter requireAuth (nur eingeloggte
// Teammitglieder). Schreiboperationen gehen immer ZUERST nach easybill
// (führendes System) und werden erst danach in den Cache übernommen.

import { Router } from 'express';
import { supabase } from '../supabase.js';
import { getCustomer, createCustomer, updateCustomer } from '../easybill.js';
import {
  syncAllCustomers,
  upsertCustomerInCache,
  getSyncStatus,
  mapCustomerToRow,
} from '../easybill-sync.js';

const router = Router();

/** GET /api/easybill-customers/search?q=…&limit=20
 *  Sucht im lokalen Cache über company_name, number, email, first/last_name.
 */
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));

  let query = supabase
    .from('talentone_easybill_customers')
    .select('id, easybill_id, number, company_name, first_name, last_name, email, city, zip_code, street, country, phone_1, synced_at')
    .order('company_name')
    .limit(limit);

  if (q) {
    // OR-Suche auf mehrere Felder — PostgREST-Syntax
    const needle = q.replace(/,/g, ' ');
    const pattern = `%${needle}%`;
    query = query.or(
      `company_name.ilike.${pattern},number.ilike.${pattern},email.ilike.${pattern},first_name.ilike.${pattern},last_name.ilike.${pattern}`
    );
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ customers: data || [] });
});

/** GET /api/easybill-customers/dubletten-check?company_name=…
 *  Fuzzy-Suche über Trigram-Similarity — wird beim Neu-Anlegen genutzt,
 *  um "Meinten Sie: …?"-Vorschläge zu bringen.
 */
router.get('/dubletten-check', async (req, res) => {
  const name = (req.query.company_name || '').toString().trim();
  if (!name) return res.json({ matches: [] });
  // Pragmatisch: die längsten Wörter (≥3 Zeichen) per ilike-Substring suchen.
  // Trigram-Index existiert; feineres Similarity-Ranking heben wir uns für
  // eine spätere RPC auf, falls die einfache ilike-Suche nicht reicht.
  const words = name.toLowerCase().split(/\s+/).filter(w => w.length >= 3).slice(0, 3);
  if (!words.length) return res.json({ matches: [] });

  const pattern = `%${words.join('%')}%`;
  const { data, error } = await supabase
    .from('talentone_easybill_customers')
    .select('id, easybill_id, number, company_name, city, email')
    .ilike('company_name', pattern)
    .limit(5);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ matches: data || [] });
});

/** GET /api/easybill-customers/:id  (id = lokale UUID) */
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('talentone_easybill_customers')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Kunde nicht im Cache gefunden.' });
  res.json({ customer: data });
});

/** POST /api/easybill-customers/sync — on-demand-Sync. */
router.post('/sync', async (req, res) => {
  try {
    const result = await syncAllCustomers();
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** GET /api/easybill-customers/sync/status */
router.get('/sync/status', (req, res) => {
  res.json(getSyncStatus());
});

/** POST /api/easybill-customers
 *  body: { company_name, first_name?, last_name, street, zip_code, city, country?, email?, phone_1?, vat_identifier? }
 *  Legt neuen Kunden in easybill an, übernimmt anschließend in den Cache.
 */
router.post('/', async (req, res) => {
  const b = req.body || {};
  if (!b.company_name || !b.company_name.trim()) return res.status(400).json({ error: 'company_name ist Pflicht.' });
  if (!b.last_name    || !b.last_name.trim())    return res.status(400).json({ error: 'last_name ist Pflicht.' });

  try {
    const created = await createCustomer({
      firmenname:     b.company_name.trim(),
      ansprechpartner: [b.first_name, b.last_name].filter(Boolean).join(' ').trim() || b.last_name.trim(),
      email:           b.email || null,
      telefon:         b.phone_1 || null,
      strasse:         b.street || null,
      plz:             b.zip_code || null,
      ort:             b.city || null,
      land:            b.country || 'DE',
      ust_id:          b.vat_identifier || null,
    });
    const cached = await upsertCustomerInCache(created);
    res.status(201).json({ customer: cached, easybill_customer: created });
  } catch (err) {
    console.error('[easybill-customers POST]', err.message);
    res.status(502).json({ error: `easybill: ${err.message}` });
  }
});

/** PATCH /api/easybill-customers/:id
 *  body: beliebige Untermenge von { company_name, first_name, last_name, street, zip_code, city, country, email, phone_1, vat_identifier }
 *  Update-Reihenfolge: 1) easybill 2) Cache (erneut aus easybill lesen, damit updated_at etc. stimmen).
 */
router.patch('/:id', async (req, res) => {
  const b = req.body || {};
  try {
    // Cache-Row auflösen → easybill_id
    const { data: cur, error } = await supabase
      .from('talentone_easybill_customers')
      .select('easybill_id')
      .eq('id', req.params.id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!cur) return res.status(404).json({ error: 'Kunde nicht im Cache gefunden.' });

    // Nur bekannte easybill-Felder durchreichen
    const patch = {};
    for (const k of ['company_name', 'first_name', 'last_name', 'street', 'zip_code', 'city', 'country', 'phone_1', 'phone_2', 'vat_identifier']) {
      if (b[k] !== undefined) patch[k] = b[k];
    }
    if (b.email !== undefined) {
      patch.emails = b.email ? [b.email] : [];
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Keine Änderungen übergeben.' });

    await updateCustomer(cur.easybill_id, patch);
    const fresh = await getCustomer(cur.easybill_id); // holt das aktualisierte Objekt zurück
    const cached = await upsertCustomerInCache(fresh);
    res.json({ customer: cached });
  } catch (err) {
    console.error('[easybill-customers PATCH]', err.message);
    res.status(502).json({ error: `easybill: ${err.message}` });
  }
});

export default router;
