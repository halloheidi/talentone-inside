// Projekte (Kanban / Liste) — CRUD + Kommentare
// Geschützt (requireAuth in server.js gemountet)

import { Router } from 'express';
import { supabase } from '../supabase.js';

const router = Router();

const PROJEKTE_STATI = [
  'vorbereitung', 'kickoff_vereinbart', 'onboarding',
  'golive_vereinbart', 'warte_auf_go', 'live',
  'pausiert', 'hold', 'abgeschlossen',
];

const ALLOWED_FIELDS = [
  'projektnummer', 'projekt', 'kunde', 'closer', 'projektart', 'projektdauer',
  'status', 'deadline_vorbereitung', 'gesuchte_positionen', 'standorte',
  'start_phase1', 'ende_phase1', 'phase1_einstellungen',
  'start_phase2', 'ende_phase2', 'phase2_einstellungen',
  'zufriedenheit', 'startdatum_abo', 'enddatum_abo', 'pausiert_seit',
  'ziel_erreicht', 're_bezahlt', 're2_bezahlt', 'bewertet',
  'notizen', 'pixel',
  'ready_for_upsell', 'upsell_wer', 'position_im_unternehmen', 'persoenlichkeitstyp',
  'email', 'verantwortlich', 'fotograf', 'letzter_kontakt', 'kontaktstatus',
  'werbekosten', 'close_lead_id', 'kunde_id', 'checkliste',
];

function pickFields(body) {
  const out = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (!ALLOWED_FIELDS.includes(k)) continue;
    out[k] = v === '' ? null : v;
  }
  return out;
}

/* GET /api/projekte — Liste aller Projekte mit Kommentar-Count */
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('talentone_projekte')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  // Kommentar-Zähler dazu joinen (einzelner aggregate-call)
  const { data: counts } = await supabase
    .from('talentone_kommentare')
    .select('projekt_id', { count: 'exact', head: false });
  const countMap = {};
  for (const c of counts || []) {
    countMap[c.projekt_id] = (countMap[c.projekt_id] || 0) + 1;
  }

  const enriched = (data || []).map(p => ({ ...p, kommentar_count: countMap[p.id] || 0 }));
  res.json({ projekte: enriched });
});

/* POST /api/projekte — neues Projekt */
router.post('/', async (req, res) => {
  const patch = pickFields(req.body);
  if (!patch.projekt && !patch.kunde) {
    return res.status(400).json({ error: 'Projektname oder Kunde ist Pflicht.' });
  }
  if (patch.status && !PROJEKTE_STATI.includes(patch.status)) {
    return res.status(400).json({ error: `Status muss eines von: ${PROJEKTE_STATI.join(', ')}` });
  }
  const { data, error } = await supabase
    .from('talentone_projekte')
    .insert({ ...patch, updated_at: new Date().toISOString() })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ projekt: data });
});

/* GET /api/projekte/:id */
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('talentone_projekte').select('*').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Projekt nicht gefunden.' });
  res.json({ projekt: data });
});

/* PATCH /api/projekte/:id — inline-Update */
router.patch('/:id', async (req, res) => {
  const patch = pickFields(req.body);
  if (patch.status && !PROJEKTE_STATI.includes(patch.status)) {
    return res.status(400).json({ error: `Status ungültig.` });
  }
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabase
    .from('talentone_projekte')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ projekt: data });
});

/* DELETE /api/projekte/:id */
router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('talentone_projekte').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

/* ════════════════════ Kommentare ════════════════════ */

/* GET /api/projekte/:id/kommentare */
router.get('/:id/kommentare', async (req, res) => {
  const { data, error } = await supabase
    .from('talentone_kommentare')
    .select('*')
    .eq('projekt_id', req.params.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ kommentare: data || [] });
});

/* POST /api/projekte/:id/kommentare  body: { text, erwaehnungen[], autor? } */
router.post('/:id/kommentare', async (req, res) => {
  const { text, erwaehnungen, autor } = req.body || {};
  if (!text?.trim()) return res.status(400).json({ error: 'Text fehlt.' });

  const { data: projekt } = await supabase
    .from('talentone_projekte').select('id, projekt').eq('id', req.params.id).maybeSingle();
  if (!projekt) return res.status(404).json({ error: 'Projekt nicht gefunden.' });

  const autorName = (autor || req.user?.email || 'Mitarbeiter').toString();
  const erw = Array.isArray(erwaehnungen) ? erwaehnungen.filter(Boolean).slice(0, 20) : [];

  const { data, error } = await supabase
    .from('talentone_kommentare')
    .insert({
      projekt_id: projekt.id,
      autor: autorName,
      text: text.trim(),
      erwaehnungen: erw,
      quelle: 'intern',
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });

  res.status(201).json({ kommentar: data });

  // @-Mention-E-Mail im Hintergrund (best-effort) — kommt in Iteration 2
});

/* PATCH /api/projekte/kommentare/:id */
router.patch('/kommentare/:id', async (req, res) => {
  const { text, erwaehnungen } = req.body || {};
  const patch = {};
  if (text !== undefined) patch.text = (text || '').trim();
  if (erwaehnungen !== undefined) patch.erwaehnungen = Array.isArray(erwaehnungen) ? erwaehnungen : [];
  const { data, error } = await supabase
    .from('talentone_kommentare').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ kommentar: data });
});

/* DELETE /api/projekte/kommentare/:id */
router.delete('/kommentare/:id', async (req, res) => {
  const { error } = await supabase.from('talentone_kommentare').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

export default router;
