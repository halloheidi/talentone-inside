import { Router } from 'express';
import { supabase } from '../supabase.js';

const router = Router();

// GET /api/creatives?job_id=...
router.get('/', async (req, res) => {
  let q = supabase.from('talentone_creatives').select('*').order('created_at', { ascending: false });
  if (req.query.job_id) q = q.eq('job_id', req.query.job_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ creatives: data });
});

router.post('/', async (req, res) => {
  const { job_id } = req.body || {};
  if (!job_id) return res.status(400).json({ error: 'job_id ist Pflicht.' });
  const { data, error } = await supabase
    .from('talentone_creatives')
    .insert(req.body)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ creative: data });
});

router.patch('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('talentone_creatives')
    .update(req.body)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ creative: data });
});

router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('talentone_creatives').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

export default router;
