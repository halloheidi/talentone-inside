import { Router } from 'express';
import { supabase } from '../supabase.js';

const router = Router();

/* GET /api/stilvorlagen?include_inactive=1 */
router.get('/', async (req, res) => {
  const includeInactive = req.query.include_inactive === '1';
  let q = supabase.from('talentone_stilvorlagen').select('*')
    .order('reihenfolge', { ascending: true });
  if (!includeInactive) q = q.eq('aktiv', true);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ stilvorlagen: data || [] });
});

router.get('/:id', async (req, res) => {
  const { data, error } = await supabase.from('talentone_stilvorlagen')
    .select('*').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Stilvorlage nicht gefunden.' });
  res.json({ stilvorlage: data });
});

const ALLOWED = ['name', 'beschreibung', 'layout_prompt', 'vorschau_url',
                 'referenzbild_nutzen', 'aktiv', 'reihenfolge'];

router.post('/', async (req, res) => {
  const patch = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => ALLOWED.includes(k)));
  if (!patch.name || !patch.layout_prompt) {
    return res.status(400).json({ error: 'name und layout_prompt sind Pflicht.' });
  }
  const { data, error } = await supabase.from('talentone_stilvorlagen')
    .insert(patch).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ stilvorlage: data });
});

router.patch('/:id', async (req, res) => {
  const patch = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => ALLOWED.includes(k)));
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('talentone_stilvorlagen')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ stilvorlage: data });
});

router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('talentone_stilvorlagen')
    .delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

export default router;
