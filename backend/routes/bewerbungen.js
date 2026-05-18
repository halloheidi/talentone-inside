// Bewerber-Management — Notizen, Kundenfeedback, eigene Spalten,
// globale Übersicht. Geschützt (requireAuth).

import { Router } from 'express';
import { supabase } from '../supabase.js';

const router = Router();

const NOTIZ_STATI = ['neu', 'kontaktiert', 'interessiert', 'abgesagt', 'weitergeleitet'];
const FEEDBACK_STATI = ['neu', 'interessant', 'vorstellungsgespraech', 'eingestellt', 'abgesagt'];

const ANRUF_ERGEBNISSE = ['erreicht', 'nicht_erreicht', 'mailbox'];

function sanitizeAnrufversuche(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 10).map(a => ({
    datum: a?.datum || null,
    ergebnis: ANRUF_ERGEBNISSE.includes(a?.ergebnis) ? a.ergebnis : null,
    notiz: a?.notiz?.toString().slice(0, 500) || '',
  }));
}

/* ════════════════════ Notizen (intern) ════════════════════ */

// PATCH /api/bewerbungen/:id/notiz  body: { status?, bewertung?, gehaltswunsch?, ... }
router.patch('/:id/notiz', async (req, res) => {
  const bewId = req.params.id;
  const patch = {};
  const body = req.body || {};
  if (body.status !== undefined) {
    patch.status = NOTIZ_STATI.includes(body.status) ? body.status : 'neu';
  }
  if (body.bewertung !== undefined) {
    const n = Number(body.bewertung);
    patch.bewertung = (Number.isInteger(n) && n >= 1 && n <= 5) ? n : null;
  }
  for (const k of ['gehaltswunsch', 'verfuegbarkeit', 'naechste_aktion', 'notizen']) {
    if (body[k] !== undefined) patch[k] = (body[k]?.toString().trim()) || null;
  }
  if (body.anrufversuche !== undefined) {
    patch.anrufversuche = sanitizeAnrufversuche(body.anrufversuche);
  }
  patch.updated_at = new Date().toISOString();
  patch.bewerbung_id = bewId;

  const { data, error } = await supabase
    .from('talentone_bewerber_notizen')
    .upsert(patch, { onConflict: 'bewerbung_id' })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ notiz: data });
});

/* ════════════════════ Eigene Spalten pro Job ════════════════════ */

// GET /api/bewerbungen/job/:jobId/spalten — nur intern-sichtbare
router.get('/job/:jobId/spalten', async (req, res) => {
  const { data, error } = await supabase
    .from('talentone_bewerber_spalten')
    .select('*')
    .eq('job_id', req.params.jobId)
    .eq('sichtbar_fuer', 'intern')
    .order('reihenfolge', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ spalten: data || [] });
});

// POST /api/bewerbungen/job/:jobId/spalten  body: { name, typ, optionen? }
router.post('/job/:jobId/spalten', async (req, res) => {
  const { name, typ = 'text', optionen = null } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'name fehlt.' });
  if (!['text', 'dropdown', 'datum'].includes(typ)) return res.status(400).json({ error: 'typ ungültig.' });

  const { data: last } = await supabase
    .from('talentone_bewerber_spalten')
    .select('reihenfolge')
    .eq('job_id', req.params.jobId)
    .order('reihenfolge', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from('talentone_bewerber_spalten')
    .insert({
      job_id: req.params.jobId,
      name: name.trim().slice(0, 80),
      typ,
      optionen: Array.isArray(optionen) ? optionen.map(o => String(o).slice(0, 80)).slice(0, 30) : null,
      reihenfolge: (last?.reihenfolge ?? -1) + 1,
      sichtbar_fuer: 'intern',
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ spalte: data });
});

// DELETE /api/bewerbungen/spalten/:id
router.delete('/spalten/:id', async (req, res) => {
  const { error } = await supabase
    .from('talentone_bewerber_spalten').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// PUT /api/bewerbungen/:bewId/spalten/:spalteId  body: { wert }
router.put('/:bewId/spalten/:spalteId', async (req, res) => {
  const wert = req.body?.wert == null ? null : String(req.body.wert);
  const { data, error } = await supabase
    .from('talentone_bewerber_spalten_werte')
    .upsert({
      bewerbung_id: req.params.bewId,
      spalte_id: req.params.spalteId,
      wert,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'bewerbung_id,spalte_id' })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ wert: data });
});

/* ════════════════════ Listing für einen Job ════════════════════ */

async function loadBewerbungenFuerJob(jobId) {
  const { data: bewerbungen, error } = await supabase
    .from('talentone_bewerbungen')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  const ids = bewerbungen.map(b => b.id);
  if (ids.length === 0) {
    return { bewerbungen: [], notizen: {}, feedback: {}, werte: {} };
  }

  const [notizenRes, feedbackRes, werteRes] = await Promise.all([
    supabase.from('talentone_bewerber_notizen').select('*').in('bewerbung_id', ids),
    supabase.from('talentone_bewerber_kundenfeedback').select('*').in('bewerbung_id', ids),
    supabase.from('talentone_bewerber_spalten_werte').select('*').in('bewerbung_id', ids),
  ]);

  const notizen = {};
  for (const n of notizenRes.data || []) notizen[n.bewerbung_id] = n;
  const feedback = {};
  for (const f of feedbackRes.data || []) feedback[f.bewerbung_id] = f;
  const werte = {};
  for (const w of werteRes.data || []) {
    if (!werte[w.bewerbung_id]) werte[w.bewerbung_id] = {};
    werte[w.bewerbung_id][w.spalte_id] = w.wert;
  }

  return { bewerbungen, notizen, feedback, werte };
}

// GET /api/bewerbungen/job/:jobId — komplette Tabellen-Daten für einen Job
router.get('/job/:jobId', async (req, res) => {
  try {
    const data = await loadBewerbungenFuerJob(req.params.jobId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ════════════════════ Globale Übersicht ════════════════════ */

// GET /api/bewerbungen — alle Bewerbungen mit Filter
router.get('/', async (req, res) => {
  const { kunde_id, job_id, quelle, ohne_ko, von, bis } = req.query;

  let q = supabase
    .from('talentone_bewerbungen')
    .select('*, talentone_jobs!inner(id, stelle, region, kunde_id, bewerbungen_token, talentone_kunden!inner(id, firmenname, agentur))')
    .order('created_at', { ascending: false });

  if (job_id) q = q.eq('job_id', job_id);
  if (quelle) q = q.eq('quelle', quelle);
  if (ohne_ko === '1') q = q.eq('ko_kriterium', false);
  if (von) q = q.gte('created_at', von);
  if (bis) q = q.lte('created_at', bis);

  const { data: bewerbungen, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  let filtered = bewerbungen || [];
  if (kunde_id) {
    filtered = filtered.filter(b => b.talentone_jobs?.kunde_id === kunde_id);
  }

  const ids = filtered.map(b => b.id);
  let notizen = {};
  let feedback = {};
  if (ids.length > 0) {
    const [n, f] = await Promise.all([
      supabase.from('talentone_bewerber_notizen').select('*').in('bewerbung_id', ids),
      supabase.from('talentone_bewerber_kundenfeedback').select('*').in('bewerbung_id', ids),
    ]);
    for (const x of n.data || []) notizen[x.bewerbung_id] = x;
    for (const x of f.data || []) feedback[x.bewerbung_id] = x;
  }

  // Stats berechnen (auf ungefilterte Basis-Liste basierend auf Datums-/KO-Filter,
  // nicht nach Kunde/Job — Stats sollen den Gesamt-Workflow zeigen).
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const weekStart = new Date(today); weekStart.setDate(today.getDate() - today.getDay());

  let neueHeute = 0, offen = 0, inBearbeitung = 0, weitergeleitetWoche = 0;
  for (const b of filtered) {
    const d = new Date(b.created_at);
    if (d >= today) neueHeute++;
    const n = notizen[b.id];
    const status = n?.status || 'neu';
    if (status === 'neu') offen++;
    else if (status === 'kontaktiert' || status === 'interessiert') inBearbeitung++;
    if (status === 'weitergeleitet' && new Date(n?.updated_at || b.created_at) >= weekStart) weitergeleitetWoche++;
  }

  res.json({
    bewerbungen: filtered,
    notizen,
    feedback,
    stats: { neueHeute, offen, inBearbeitung, weitergeleitetWoche },
  });
});

export default router;
