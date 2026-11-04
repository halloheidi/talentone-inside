import { Router } from 'express';
import { supabase } from '../supabase.js';
import { requireAdmin } from '../auth.js';

const router = Router();
const TABLE = 'talentone_vorqual_standardfelder';
const TYPEN = new Set(['text', 'select', 'janein', 'zahl']);
const SICHTBAR = new Set(['intern', 'kunde']);

// Request-Body → saubere Spaltenwerte (nur erlaubte Felder, validierte Enums).
function sanitize(body = {}, { partial = false } = {}) {
  const out = {};
  if (body.name !== undefined) out.name = String(body.name || '').trim();
  if (body.typ !== undefined) out.typ = TYPEN.has(body.typ) ? body.typ : 'text';
  if (body.optionen !== undefined) out.optionen = Array.isArray(body.optionen) ? body.optionen.map(String).filter(Boolean) : null;
  if (body.notiz_feld !== undefined) out.notiz_feld = body.notiz_feld ? String(body.notiz_feld) : null;
  if (body.validierung !== undefined) out.validierung = body.validierung ? String(body.validierung) : null;
  if (body.reihenfolge !== undefined) out.reihenfolge = Number.isFinite(+body.reihenfolge) ? Math.round(+body.reihenfolge) : 0;
  if (body.aktiv !== undefined) out.aktiv = !!body.aktiv;
  if (body.sichtbar_fuer !== undefined) out.sichtbar_fuer = SICHTBAR.has(body.sichtbar_fuer) ? body.sichtbar_fuer : 'kunde';
  if (!partial && !out.name) throw new Error('Name ist erforderlich.');
  return out;
}

// GET /api/vorqual-standardfelder — alle Felder (inkl. inaktive) für die Admin-Seite.
router.get('/', async (req, res) => {
  const { data, error } = await supabase.from(TABLE).select('*').order('reihenfolge', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ felder: data || [] });
});

// POST /api/vorqual-standardfelder — neues Feld (Admin).
router.post('/', requireAdmin, async (req, res) => {
  try {
    const patch = sanitize(req.body);
    // Default-Reihenfolge ans Ende, wenn nicht gesetzt.
    if (patch.reihenfolge === undefined) {
      const { data: max } = await supabase.from(TABLE).select('reihenfolge').order('reihenfolge', { ascending: false }).limit(1).maybeSingle();
      patch.reihenfolge = (max?.reihenfolge ?? 0) + 10;
    }
    const { data, error } = await supabase.from(TABLE).insert(patch).select('*').maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ feld: data });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// PUT /api/vorqual-standardfelder/:id — Feld ändern (Admin). Auch zum (De-)Aktivieren.
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const patch = sanitize(req.body, { partial: true });
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nichts zu ändern.' });
    const { data, error } = await supabase.from(TABLE).update(patch).eq('id', req.params.id).select('*').maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Feld nicht gefunden.' });
    res.json({ feld: data });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// DELETE /api/vorqual-standardfelder/:id — Feld löschen (Admin).
router.delete('/:id', requireAdmin, async (req, res) => {
  const { error } = await supabase.from(TABLE).delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

export default router;
