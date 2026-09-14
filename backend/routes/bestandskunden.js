// Bestandskunden-API (Admin). Liste (Aggregate aus der View), Detail-Rechnungen,
// Inline-Edit der Steuerfelder (löst Close-Task-Sync aus), manuelle Syncs.

import { Router } from 'express';
import { supabase } from '../supabase.js';
import { listUsers } from '../close.js';
import { applyCloseTaskState } from '../bestandskunden-close.js';
import { runBestandskundenSync, runCloseTaskStatusSync, getBestandskundenSyncStatus } from '../bestandskunden-sync.js';

const router = Router();
const REAKT = new Set(['offen', 'angehen', 'verbrannt']);

// GET /api/bestandskunden — komplette Liste inkl. Aggregate + Status.
router.get('/', async (req, res) => {
  const { data, error } = await supabase.from('talentone_bk_kunden_uebersicht')
    .select('*').order('letzte_rechnung', { ascending: true, nullsFirst: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ kunden: data || [] });
});

// GET /api/bestandskunden/close-users — für das Zuständig-Dropdown.
router.get('/close-users', async (req, res) => {
  if (!process.env.CLOSE_API_KEY) return res.json({ users: [] });
  try { res.json({ users: await listUsers() }); }
  catch (err) { res.status(502).json({ error: err.message, users: [] }); }
});

// GET /api/bestandskunden/sync/status
router.get('/sync/status', (req, res) => res.json(getBestandskundenSyncStatus()));

// GET /api/bestandskunden/:id/rechnungen — Rechnungshistorie.
router.get('/:id/rechnungen', async (req, res) => {
  const { data, error } = await supabase.from('talentone_bk_rechnungen')
    .select('*').eq('bk_kunde_id', req.params.id).order('datum', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ rechnungen: data || [] });
});

// PATCH /api/bestandskunden/:id — Steuerfelder ändern (+ Close-Sync).
router.patch('/:id', async (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (b.reaktivierung !== undefined) {
    if (!REAKT.has(b.reaktivierung)) return res.status(400).json({ error: "reaktivierung muss 'offen', 'angehen' oder 'verbrannt' sein." });
    patch.reaktivierung = b.reaktivierung;
  }
  for (const f of ['zustaendig_close_user_id', 'notiz', 'telefon', 'email', 'close_lead_id']) {
    if (b[f] !== undefined) patch[f] = b[f] === '' ? null : b[f];
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Keine Änderungen.' });
  patch.updated_at = new Date().toISOString();

  const { data: updated, error } = await supabase.from('talentone_bk_kunden')
    .update(patch).eq('id', req.params.id).select('id').single();
  if (error || !updated) return res.status(error ? 500 : 404).json({ error: error?.message || 'Kunde nicht gefunden.' });

  // Close-Task nur bei Steuer-relevanten Änderungen abgleichen (nicht bei Tel/Email).
  const closeRelevant = ['reaktivierung', 'zustaendig_close_user_id', 'notiz', 'close_lead_id'].some(f => patch[f] !== undefined);
  if (!closeRelevant) {
    const { data: k } = await supabase.from('talentone_bk_kunden_uebersicht').select('*').eq('id', req.params.id).maybeSingle();
    return res.json({ kunde: k });
  }
  const result = await applyCloseTaskState(req.params.id);
  res.json(result);
});

// POST /api/bestandskunden/sync — manueller easybill+close-Sync.
router.post('/sync', async (req, res) => {
  try { res.json({ ok: true, result: await runBestandskundenSync() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/bestandskunden/close-status-refresh — nur Close-Task-Status abgleichen.
router.post('/close-status-refresh', async (req, res) => {
  try { res.json({ ok: true, result: await runCloseTaskStatusSync() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
