// Bestandskunden-API (Admin). Liste (Aggregate aus der View), Detail-Rechnungen,
// Inline-Edit der Steuerfelder (löst Close-Task-Sync aus), manuelle Syncs.

import { Router } from 'express';
import { supabase } from '../supabase.js';
import { listUsers, getCloseKey, addTask } from '../close.js';
import { applyCloseTaskState } from '../bestandskunden-close.js';
import { runBestandskundenSync, runCloseTaskStatusSync, getBestandskundenSyncStatus } from '../bestandskunden-sync.js';

const router = Router();
const REAKT = new Set(['offen', 'angehen', 'verbrannt']);
const GW_STATUS = new Set(['interessant', 'angesprochen', 'registriert', 'kein_interesse']);

// Legt einen Close-Task „Gesellenwerk-Betrieb" am verknüpften Lead an (nur falls
// close_lead_id vorhanden). Analog zum „Altkunde"-Task, aber eigener Anlass.
// Fehler blockieren nie das Speichern — Aufrufer zeigt eine Warnung.
async function createGesellenwerkTask(kunde) {
  if (!kunde.close_lead_id) return 'Kein Close-Lead verknüpft — Gesellenwerk-Task nicht angelegt.';
  if (!(await getCloseKey())) return 'CLOSE_API_KEY nicht gesetzt — Gesellenwerk-Task nicht angelegt.';
  try {
    const due = new Date(); due.setDate(due.getDate() + 1);
    let text = `Gesellenwerk-Betrieb: ${kunde.firma || ''} als Partnerbetrieb für gesellenwerk.de ansprechen.`;
    if (kunde.gw_notiz && kunde.gw_notiz.trim()) text += `\n\n${kunde.gw_notiz.trim()}`;
    await addTask({ leadId: kunde.close_lead_id, text, assignedTo: kunde.zustaendig_close_user_id || null, dueIso: due.toISOString() });
    return null;
  } catch (e) { return `Gesellenwerk-Task fehlgeschlagen: ${e.message}`; }
}

// GET /api/bestandskunden — komplette Liste inkl. Aggregate + Status.
router.get('/', async (req, res) => {
  const { data, error } = await supabase.from('talentone_bk_kunden_uebersicht')
    .select('*').order('letzte_rechnung', { ascending: true, nullsFirst: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ kunden: data || [] });
});

// GET /api/bestandskunden/close-users — für das Zuständig-Dropdown.
router.get('/close-users', async (req, res) => {
  if (!(await getCloseKey())) return res.json({ users: [] });
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
  for (const f of ['zustaendig_close_user_id', 'notiz', 'telefon', 'email', 'close_lead_id', 'gw_notiz']) {
    if (b[f] !== undefined) patch[f] = b[f] === '' ? null : b[f];
  }

  // Gesellenwerk-Betriebsstatus: bei Änderung Zeitstempel + Nutzer mitführen.
  let gwAngesprochenNeu = false;
  if (b.gw_status !== undefined) {
    const wert = b.gw_status === '' ? null : b.gw_status;
    if (wert !== null && !GW_STATUS.has(wert)) return res.status(400).json({ error: 'Ungültiger gw_status.' });
    const { data: vorher } = await supabase.from('talentone_bk_kunden').select('gw_status').eq('id', req.params.id).maybeSingle();
    if ((vorher?.gw_status || null) !== wert) {
      patch.gw_status = wert;
      patch.gw_status_am = new Date().toISOString();
      patch.gw_status_von = req.user?.email || null;
      gwAngesprochenNeu = wert === 'angesprochen' && (vorher?.gw_status || null) !== 'angesprochen';
    }
  }

  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Keine Änderungen.' });
  patch.updated_at = new Date().toISOString();

  const { data: updated, error } = await supabase.from('talentone_bk_kunden')
    .update(patch).eq('id', req.params.id).select('id').single();
  if (error || !updated) return res.status(error ? 500 : 404).json({ error: error?.message || 'Kunde nicht gefunden.' });

  // „Angesprochen" → Close-Task „Gesellenwerk-Betrieb" am Lead (falls close_lead_id).
  let gwWarnung = null;
  if (gwAngesprochenNeu) {
    const { data: k } = await supabase.from('talentone_bk_kunden_uebersicht').select('*').eq('id', req.params.id).maybeSingle();
    gwWarnung = await createGesellenwerkTask(k || {});
  }

  // Close-Task (Altkunde) nur bei Steuer-relevanten Änderungen abgleichen (nicht bei Tel/Email/Gesellenwerk).
  const closeRelevant = ['reaktivierung', 'zustaendig_close_user_id', 'notiz', 'close_lead_id'].some(f => patch[f] !== undefined);
  if (!closeRelevant) {
    const { data: k } = await supabase.from('talentone_bk_kunden_uebersicht').select('*').eq('id', req.params.id).maybeSingle();
    return res.json({ kunde: k, ...(gwWarnung ? { close_warnung: gwWarnung } : {}) });
  }
  const result = await applyCloseTaskState(req.params.id);
  res.json({ ...result, ...(gwWarnung ? { close_warnung: gwWarnung } : {}) });
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
