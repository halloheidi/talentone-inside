// GET /api/heute (+ Interaktionen) — Admin-only, serverseitige Aggregation mit
// 5-Minuten-Cache je Nutzer. Mounted: app.use('/api/heute', requireAuth, requireAdmin, …).

import { Router } from 'express';
import { supabase } from '../supabase.js';
import { buildHeute } from '../heute.js';
import { setTaskComplete } from '../close.js';
import { SECRET_KEYS, setSecret, clearSecret, secretStatus } from '../settings-secrets.js';

const router = Router();
const CACHE_MS = 5 * 60 * 1000;
const _cache = new Map(); // email → { ts, data }
const berlinTag = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

async function ladeErledigt(email) {
  const { data } = await supabase.from('talentone_heute_erledigt')
    .select('item_key').eq('email', email).eq('tag', berlinTag());
  return (data || []).map(r => r.item_key);
}
async function ladeTodos(email) {
  const { data } = await supabase.from('talentone_heute_todos')
    .select('id, text, faellig, erledigt, created_at, erledigt_at')
    .eq('email', email).order('erledigt', { ascending: true }).order('created_at', { ascending: true });
  return data || [];
}

// GET /api/heute?refresh=1
router.get('/', async (req, res) => {
  const email = req.user?.email || 'unknown';
  try {
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const cached = _cache.get(email);
    let data;
    if (!refresh && cached && Date.now() - cached.ts < CACHE_MS) {
      data = cached.data;
    } else {
      data = await buildHeute({ userEmail: email });
      _cache.set(email, { ts: Date.now(), data });
    }
    const [erledigt_keys, todos] = await Promise.all([ladeErledigt(email), ladeTodos(email)]);
    res.json({
      ...data,
      cached: !refresh && !!cached && data === cached?.data,
      cache_alter_sekunden: cached ? Math.round((Date.now() - cached.ts) / 1000) : 0,
      erledigt_keys, todos,
    });
  } catch (err) {
    console.error('[heute]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ───── „Erledigt heute ausblenden" (pro Nutzer + Tag) ───── */
router.post('/erledigt', async (req, res) => {
  const email = req.user?.email;
  const item_key = (req.body?.item_key || '').toString().trim();
  if (!item_key) return res.status(400).json({ error: 'item_key fehlt.' });
  const { error } = await supabase.from('talentone_heute_erledigt')
    .upsert({ email, tag: berlinTag(), item_key }, { onConflict: 'email,tag,item_key' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});
router.delete('/erledigt', async (req, res) => {
  const email = req.user?.email;
  const item_key = (req.query?.item_key || req.body?.item_key || '').toString().trim();
  if (!item_key) return res.status(400).json({ error: 'item_key fehlt.' });
  const { error } = await supabase.from('talentone_heute_erledigt')
    .delete().eq('email', email).eq('tag', berlinTag()).eq('item_key', item_key);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

/* ───── Mini-To-dos ───── */
router.get('/todos', async (req, res) => {
  try { res.json({ todos: await ladeTodos(req.user?.email) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/todos', async (req, res) => {
  const text = (req.body?.text || '').toString().trim();
  const faellig = req.body?.faellig || null;
  if (!text) return res.status(400).json({ error: 'Text fehlt.' });
  const { data, error } = await supabase.from('talentone_heute_todos')
    .insert({ email: req.user?.email, text, faellig }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ todo: data });
});
router.patch('/todos/:id', async (req, res) => {
  const patch = {};
  if ('text' in (req.body || {})) patch.text = String(req.body.text).trim();
  if ('faellig' in (req.body || {})) patch.faellig = req.body.faellig || null;
  if ('erledigt' in (req.body || {})) {
    patch.erledigt = !!req.body.erledigt;
    patch.erledigt_at = patch.erledigt ? new Date().toISOString() : null;
  }
  const { data, error } = await supabase.from('talentone_heute_todos')
    .update(patch).eq('id', req.params.id).eq('email', req.user?.email).select().maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Nicht gefunden.' });
  res.json({ todo: data });
});
router.delete('/todos/:id', async (req, res) => {
  const { error } = await supabase.from('talentone_heute_todos')
    .delete().eq('id', req.params.id).eq('email', req.user?.email);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

/* ───── Close-Task abhaken / Undo ───── */
router.post('/close-task/:id/complete', async (req, res) => {
  try {
    const complete = req.body?.complete !== false; // default: erledigen
    await setTaskComplete(req.params.id, complete);
    _cache.delete(req.user?.email); // nächster Load zeigt den neuen Stand
    res.json({ ok: true, complete });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/* ───── Layout-Prefs (Kachel-Reihenfolge + Sichtbarkeit, pro Nutzer) ───── */
router.get('/prefs', async (req, res) => {
  const { data } = await supabase.from('talentone_heute_prefs')
    .select('layout').eq('email', req.user?.email).maybeSingle();
  res.json({ layout: data?.layout || {} });
});
router.put('/prefs', async (req, res) => {
  const layout = req.body?.layout;
  if (!layout || typeof layout !== 'object') return res.status(400).json({ error: 'layout fehlt.' });
  const clean = {
    order: Array.isArray(layout.order) ? layout.order.filter(x => typeof x === 'string').slice(0, 20) : undefined,
    hidden: Array.isArray(layout.hidden) ? layout.hidden.filter(x => typeof x === 'string').slice(0, 20) : undefined,
  };
  const { error } = await supabase.from('talentone_heute_prefs')
    .upsert({ email: req.user?.email, layout: clean, updated_at: new Date().toISOString() }, { onConflict: 'email' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, layout: clean });
});

/* ───── API-Key-Verwaltung (Close / Instantly) — maskiert ───── */
const DASHBOARD_KEYS = ['close_api_key', 'instantly_api_key']; // Google-OAuth läuft über /api/gmail
router.get('/keys', async (req, res) => {
  const out = {};
  for (const key of DASHBOARD_KEYS) out[key] = { label: SECRET_KEYS[key].label, ...(await secretStatus(key)) };
  res.json({ keys: out });
});
router.put('/keys/:name', async (req, res) => {
  const name = req.params.name;
  if (!DASHBOARD_KEYS.includes(name) || !SECRET_KEYS[name]) return res.status(400).json({ error: 'Unbekannter Key.' });
  const wert = (req.body?.wert || '').toString().trim();
  if (!wert) return res.status(400).json({ error: 'Wert fehlt.' });
  try {
    await setSecret(name, wert, req.user?.email);
    _cache.clear();
    res.json({ ok: true, status: await secretStatus(name) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/keys/:name', async (req, res) => {
  const name = req.params.name;
  if (!DASHBOARD_KEYS.includes(name) || !SECRET_KEYS[name]) return res.status(400).json({ error: 'Unbekannter Key.' });
  try {
    await clearSecret(name);
    _cache.clear();
    res.json({ ok: true, status: await secretStatus(name) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
