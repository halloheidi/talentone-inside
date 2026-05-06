import { Router } from 'express';
import { supabase } from '../supabase.js';

const router = Router();

router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('talentone_kunden')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ kunden: data });
});

router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('talentone_kunden')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Kunde nicht gefunden.' });
  res.json({ kunde: data });
});

router.post('/', async (req, res) => {
  const { firmenname, ansprechpartner, email, telefon, logo_url, branche, notizen } = req.body || {};
  if (!firmenname) return res.status(400).json({ error: 'firmenname ist Pflicht.' });
  const { data, error } = await supabase
    .from('talentone_kunden')
    .insert({ firmenname, ansprechpartner, email, telefon, logo_url, branche, notizen })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ kunde: data });
});

router.patch('/:id', async (req, res) => {
  const allowed = ['firmenname', 'ansprechpartner', 'email', 'telefon', 'logo_url', 'branche', 'notizen'];
  const patch = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
  const { data, error } = await supabase
    .from('talentone_kunden')
    .update(patch)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ kunde: data });
});

router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('talentone_kunden').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

export default router;
