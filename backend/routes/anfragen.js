// Neukunden-Anfragen (Migration 021).
//
// Wird für Projekttyp „Neukundengewinnung" verwendet — analoges Muster zur
// Bewerberliste, nur mit angepassten Feldern und Status-Enum. Öffentliche
// Kunden-Sicht läuft über Token (`talentone_jobs.anfragen_token`).
// Interner Zugriff geht über die authentifizierte Route.

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { supabase } from '../supabase.js';

const router = Router();

const STATUS_OPTIONS = ['neu', 'kontaktiert', 'termin', 'gewonnen', 'verloren'];

/* GET /api/anfragen?job_id=… — Interne Liste. */
router.get('/', async (req, res) => {
  const { job_id } = req.query;
  if (!job_id) return res.status(400).json({ error: 'job_id ist Pflicht.' });
  const { data, error } = await supabase.from('talentone_anfragen')
    .select('*').eq('job_id', job_id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ anfragen: data || [] });
});

/* PATCH /api/anfragen/:id — Status/Notizen updaten (Auth-geschützt). */
router.patch('/:id', async (req, res) => {
  const patch = pickPatch(req.body || {});
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Keine gültigen Felder.' });
  const { data, error } = await supabase.from('talentone_anfragen')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ anfrage: data });
});

/* POST /api/anfragen/manual  body: { job_id, name?, email?, telefon?, daten? }
   Manuelles Anlegen einer Anfrage (z. B. Telefongespräch). */
router.post('/manual', async (req, res) => {
  const { job_id, name, email, telefon, daten, notizen } = req.body || {};
  if (!job_id) return res.status(400).json({ error: 'job_id ist Pflicht.' });
  const { data, error } = await supabase.from('talentone_anfragen').insert({
    job_id,
    name:    (name || '').trim() || null,
    email:   (email || '').trim() || null,
    telefon: (telefon || '').trim() || null,
    daten:   daten || {},
    notizen: notizen || null,
    quelle:  'manual',
    status:  'neu',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ anfrage: data });
});

/* POST /api/jobs/:id/ensure-anfragen-token — legt Token an, wenn keiner da ist.
   Rückgabe: der Token. Wird von der Funnel-UI aufgerufen, um die Public-URL
   für die Anfragen-Liste anzeigen zu können. */
router.post('/token/ensure/:jobId', async (req, res) => {
  const { data: job } = await supabase.from('talentone_jobs')
    .select('id, anfragen_token').eq('id', req.params.jobId).maybeSingle();
  if (!job) return res.status(404).json({ error: 'Job nicht gefunden.' });
  if (job.anfragen_token) return res.json({ token: job.anfragen_token });
  const token = randomUUID();
  const { error } = await supabase.from('talentone_jobs')
    .update({ anfragen_token: token }).eq('id', job.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ token });
});

function pickPatch(body) {
  const out = {};
  if (body.status !== undefined) {
    if (!STATUS_OPTIONS.includes(body.status)) throw new Error('status ungültig');
    out.status = body.status;
  }
  if (body.notizen !== undefined) out.notizen = body.notizen == null ? null : String(body.notizen);
  if (body.name    !== undefined) out.name    = body.name    == null ? null : String(body.name).trim() || null;
  if (body.email   !== undefined) out.email   = body.email   == null ? null : String(body.email).trim() || null;
  if (body.telefon !== undefined) out.telefon = body.telefon == null ? null : String(body.telefon).trim() || null;
  if (body.daten   !== undefined && body.daten && typeof body.daten === 'object') out.daten = body.daten;
  return out;
}

export default router;
