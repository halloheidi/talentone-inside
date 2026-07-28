// Admin-Bereich "🎯 Eigene Leads": Lead-Liste + Sheet-Quellen-Konfiguration
// (inkl. dynamischem Close-Mapping) + Test-Lead + manueller Poll.

import { Router } from 'express';
import { supabase } from '../supabase.js';
import { requireAdmin } from '../auth.js';
import { listUsers, listLeadCustomFields, listLeadStatuses, deleteLead } from '../close.js';
import { serviceAccountEmail } from '../google-sheets.js';
import { pollAllQuellen, pollQuelle, createTestLead } from '../eigene-leads-service.js';

const router = Router();

// Felder, die beim Anlegen/Ändern einer Quelle erlaubt sind.
const QUELLE_FELDER = [
  'name', 'spreadsheet_id', 'sheet_name', 'aktiv', 'benachrichtigung',
  'close_task_text', 'close_task_assignee', 'close_task_faelligkeit',
  'close_fixed_fields', 'close_lead_status_id', 'spalten_mapping',
];
const pickQuelle = (body) => Object.fromEntries(Object.entries(body || {}).filter(([k]) => QUELLE_FELDER.includes(k)));

/* ─────────── Leads-Liste ─────────── */
router.get('/', async (req, res) => {
  const { data, error } = await supabase.from('talentone_eigene_leads')
    .select('*').order('created_at', { ascending: false }).limit(500);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ leads: data || [] });
});

// Einzelnen Lead löschen (v.a. Test-Leads). Löscht optional auch den Close-Lead.
router.delete('/:id', requireAdmin, async (req, res) => {
  const { data: lead } = await supabase.from('talentone_eigene_leads')
    .select('id, close_lead_id, ist_test').eq('id', req.params.id).maybeSingle();
  if (!lead) return res.status(404).json({ error: 'Lead nicht gefunden.' });
  if (lead.ist_test && lead.close_lead_id && req.query.close === '1') {
    try { await deleteLead(lead.close_lead_id); } catch (e) { console.warn('[eigene-leads] Close-Delete:', e.message); }
  }
  const { error } = await supabase.from('talentone_eigene_leads').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

/* ─────────── Quellen-Konfiguration ─────────── */
router.get('/quellen', async (req, res) => {
  const { data, error } = await supabase.from('talentone_lead_quellen')
    .select('*').order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ quellen: data || [] });
});

router.post('/quellen', requireAdmin, async (req, res) => {
  const patch = pickQuelle(req.body);
  if (!patch.name?.trim() || !patch.spreadsheet_id?.trim()) {
    return res.status(400).json({ error: 'name und spreadsheet_id sind Pflicht.' });
  }
  const { data, error } = await supabase.from('talentone_lead_quellen').insert(patch).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ quelle: data });
});

router.patch('/quellen/:id', requireAdmin, async (req, res) => {
  const patch = pickQuelle(req.body);
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('talentone_lead_quellen')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ quelle: data });
});

router.delete('/quellen/:id', requireAdmin, async (req, res) => {
  const { error } = await supabase.from('talentone_lead_quellen').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

/* ─────────── Close-Metadaten (für das Mapping-UI) ─────────── */
router.get('/close-metadata', async (req, res) => {
  try {
    const [users, customFields, statuses] = await Promise.all([
      listUsers().catch(() => []),
      listLeadCustomFields().catch(() => []),
      listLeadStatuses().catch(() => []),
    ]);
    res.json({ users, customFields, statuses, service_account_email: serviceAccountEmail() });
  } catch (err) {
    res.status(502).json({ error: `Close-Metadaten: ${err.message}` });
  }
});

/* ─────────── Test-Lead + manueller Poll ─────────── */
router.post('/quellen/:id/test', requireAdmin, async (req, res) => {
  const { data: quelle } = await supabase.from('talentone_lead_quellen').select('*').eq('id', req.params.id).maybeSingle();
  if (!quelle) return res.status(404).json({ error: 'Quelle nicht gefunden.' });
  try {
    const r = await createTestLead(quelle);
    res.json({ ok: r.close.ok, lead: r.lead, close_lead_id: r.close.close_lead_id || null, error: r.close.error || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manueller Poll (eine Quelle oder alle).
router.post('/poll', requireAdmin, async (req, res) => {
  try {
    if (req.body?.quelle_id) {
      const { data: q } = await supabase.from('talentone_lead_quellen').select('*').eq('id', req.body.quelle_id).maybeSingle();
      if (!q) return res.status(404).json({ error: 'Quelle nicht gefunden.' });
      const r = await pollQuelle(q);
      return res.json(r);
    }
    const r = await pollAllQuellen();
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
