import { Router } from 'express';
import { supabase } from '../supabase.js';

const router = Router();

// GET /api/jobs?kunde_id=...
router.get('/', async (req, res) => {
  let q = supabase.from('talentone_jobs').select('*').order('created_at', { ascending: false });
  if (req.query.kunde_id) q = q.eq('kunde_id', req.query.kunde_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ jobs: data });
});

router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('talentone_jobs')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Job nicht gefunden.' });
  res.json({ job: data });
});

router.post('/', async (req, res) => {
  const { kunde_id } = req.body || {};
  if (!kunde_id) return res.status(400).json({ error: 'kunde_id ist Pflicht.' });
  const { data, error } = await supabase
    .from('talentone_jobs')
    .insert(req.body)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ job: data });
});

const ALLOWED_JOB_FIELDS = [
  'stelle', 'region', 'gehalt', 'benefits', 'besonderheiten',
  'reisebereitschaft', 'quereinsteiger', 'eingabe_methode', 'url',
  'formdata_komplett', 'analyse_ergebnis',
];

router.patch('/:id', async (req, res) => {
  const patch = Object.fromEntries(
    Object.entries(req.body || {}).filter(([k]) => ALLOWED_JOB_FIELDS.includes(k))
  );
  const { data, error } = await supabase
    .from('talentone_jobs')
    .update(patch)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ job: data });
});

router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('talentone_jobs').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

export default router;
