import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { supabase } from '../supabase.js';
import { generateFragenVorschlaege, generateFunnelImage } from '../funnels.js';
import { fetchAsBuffer } from '../storage.js';

const router = Router();

const ALLOWED = ['fragen', 'pixel_id', 'conversion_ziel', 'bilder', 'veroeffentlicht'];

async function loadJobAndKunde(job_id) {
  const { data: job, error: jE } = await supabase
    .from('talentone_jobs').select('*').eq('id', job_id).single();
  if (jE || !job) throw new Error('Job nicht gefunden.');
  const { data: kunde } = await supabase
    .from('talentone_kunden').select('*').eq('id', job.kunde_id).single();
  return { job, kunde };
}

// GET /api/funnels?job_id=… — liefert oder erstellt einen Funnel für den Job
router.get('/', async (req, res) => {
  const { job_id } = req.query;
  if (!job_id) return res.status(400).json({ error: 'job_id ist Pflicht.' });

  const { data: existing, error: e1 } = await supabase
    .from('talentone_funnels').select('*').eq('job_id', job_id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (e1) return res.status(500).json({ error: e1.message });
  if (existing) return res.json({ funnel: existing });

  // Auto-create wenn keiner existiert
  const { data: created, error: e2 } = await supabase
    .from('talentone_funnels').insert({ job_id, fragen: [], bilder: {} }).select().single();
  if (e2) return res.status(500).json({ error: e2.message });
  res.json({ funnel: created });
});

router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('talentone_funnels').select('*').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Funnel nicht gefunden.' });
  res.json({ funnel: data });
});

router.patch('/:id', async (req, res) => {
  const patch = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => ALLOWED.includes(k)));
  const { data, error } = await supabase
    .from('talentone_funnels').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ funnel: data });
});

// POST /api/funnels/:id/fragen-vorschlaege
router.post('/:id/fragen-vorschlaege', async (req, res) => {
  try {
    const { data: funnel, error } = await supabase
      .from('talentone_funnels').select('*').eq('id', req.params.id).single();
    if (error || !funnel) return res.status(404).json({ error: 'Funnel nicht gefunden.' });
    const { job, kunde } = await loadJobAndKunde(funnel.job_id);
    const fragen = await generateFragenVorschlaege(job, kunde);
    // IDs vergeben
    const withIds = fragen.map(f => ({ id: randomUUID(), ...f }));
    res.json({ fragen: withIds });
  } catch (err) {
    console.error('[fragen-vorschlaege]', err.message);
    res.status(503).json({ error: err.message });
  }
});

// POST /api/funnels/:id/bild-generieren  body: { customPrompt?, format? }
router.post('/:id/bild-generieren', async (req, res) => {
  try {
    const { data: funnel, error } = await supabase
      .from('talentone_funnels').select('*').eq('id', req.params.id).single();
    if (error || !funnel) return res.status(404).json({ error: 'Funnel nicht gefunden.' });
    const { job, kunde } = await loadJobAndKunde(funnel.job_id);
    const result = await generateFunnelImage({
      job, kunde,
      customPrompt: req.body?.customPrompt,
      format: req.body?.format,
    });
    res.status(201).json(result);
  } catch (err) {
    console.error('[funnel/bild-generieren]', err.message);
    res.status(503).json({ error: err.message });
  }
});

// GET /api/funnels/:id/bewerbungen — Mitarbeiter sieht Eingänge
router.get('/:id/bewerbungen', async (req, res) => {
  const { data, error } = await supabase
    .from('talentone_bewerbungen')
    .select('*').eq('funnel_id', req.params.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ bewerbungen: data });
});

export default router;
