import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { supabase } from '../supabase.js';
import { generateFragenVorschlaege, generateFunnelImage, generateInitialScreenTexts, cropFunnelImage } from '../funnels.js';
import { fetchAsBuffer } from '../storage.js';

const router = Router();

const ALLOWED = [
  'fragen', 'pixel_id', 'conversion_ziel', 'bilder', 'veroeffentlicht', 'screens',
  'capi_access_token', 'extern', 'extern_url', 'extern_sheet_url', 'funnel_typ',
  'perspective_editor_url', 'perspective_funnel_id', 'manual_pixel_done', 'manual_webhook_done',
];

// GET /api/funnels/pixel-presets — vor /:id, sonst schluckt der Wildcard-Match.
// Quelle sind jetzt die zentral verwalteten Pixel (talentone_pixel, Migration 120) —
// KEINE hartcodierten IDs mehr. CAPI-Token kommt aus der Env (META_CAPI_TOKEN); er
// ist ein Secret und steht nie in Portal-/Public-/Mail-Antworten.
router.get('/pixel-presets', async (req, res) => {
  const { data: pixel = [] } = await supabase
    .from('talentone_pixel').select('name, gewerk, meta_pixel_id, fallback, aktiv')
    .eq('aktiv', true).order('fallback', { ascending: false }).order('name');
  const capiToken = process.env.META_CAPI_TOKEN || null;
  res.json({
    presets: (pixel || []).map(p => ({
      name: p.name + (p.fallback ? ' (Fallback)' : ''),
      dataset_id: p.meta_pixel_id,
      capi_token: capiToken,
    })),
  });
});

async function loadJobAndKunde(job_id) {
  const { data: job, error: jE } = await supabase
    .from('talentone_jobs').select('*').eq('id', job_id).single();
  if (jE || !job) throw new Error('Job nicht gefunden.');
  const { data: kunde } = await supabase
    .from('talentone_kunden').select('*').eq('id', job.kunde_id).single();
  return { job, kunde };
}

// GET /api/funnels?job_id=… — liefert den Funnel des Jobs oder null.
// KEINE Auto-Anlage mehr: ist noch keiner da, zeigt das Frontend die Typ-Auswahl
// (Perspective / onepage / Tool-Funnel intern) und legt erst nach der Wahl an.
router.get('/', async (req, res) => {
  const { job_id } = req.query;
  if (!job_id) return res.status(400).json({ error: 'job_id ist Pflicht.' });

  const { data: existing, error: e1 } = await supabase
    .from('talentone_funnels').select('*').eq('job_id', job_id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (e1) return res.status(500).json({ error: e1.message });
  res.json({ funnel: existing || null });
});

// POST /api/funnels — legt den Funnel mit gewähltem Typ an (idempotent pro Job).
// body: { job_id, funnel_typ: 'perspective'|'onepage'|'intern' }
router.post('/', async (req, res) => {
  const { job_id, funnel_typ } = req.body || {};
  if (!job_id) return res.status(400).json({ error: 'job_id ist Pflicht.' });
  const typ = ['perspective', 'onepage', 'intern'].includes(funnel_typ) ? funnel_typ : 'intern';

  const { data: existing } = await supabase
    .from('talentone_funnels').select('*').eq('job_id', job_id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (existing) {
    // Bereits vorhanden → Typ nachtragen, wenn noch keiner gesetzt ist.
    if (!existing.funnel_typ) {
      const { data: upd, error } = await supabase.from('talentone_funnels')
        .update({ funnel_typ: typ, extern: typ === 'onepage' ? true : existing.extern })
        .eq('id', existing.id).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ funnel: upd });
    }
    return res.json({ funnel: existing });
  }

  const { data: created, error } = await supabase.from('talentone_funnels')
    .insert({ job_id, funnel_typ: typ, extern: typ === 'onepage', fragen: [], bilder: {} })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
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

// POST /api/funnels/:id/initial-screens
// Generiert die ersten 3 Screen-Inhalte (intro/benefits/tasks) via Claude.
// Wenn `force` nicht gesetzt und screens bereits vorhanden, wird nichts generiert (sondern aktueller Stand zurückgegeben).
router.post('/:id/initial-screens', async (req, res) => {
  const { force } = req.body || {};
  try {
    const { data: funnel, error } = await supabase
      .from('talentone_funnels').select('*').eq('id', req.params.id).single();
    if (error || !funnel) return res.status(404).json({ error: 'Funnel nicht gefunden.' });
    if (Array.isArray(funnel.screens) && funnel.screens.length > 0 && !force) {
      return res.json({ screens: funnel.screens, generated: false });
    }
    const { job, kunde } = await loadJobAndKunde(funnel.job_id);
    const texts = await generateInitialScreenTexts(job, kunde);

    const benefitsList = Array.isArray(job.benefits) ? job.benefits.filter(Boolean) : [];
    const oldImages = funnel.bilder || {};

    const screens = [
      {
        id: randomUUID(), type: 'intro',
        headline: texts.intro?.headline || `Werde Teil von ${kunde?.firmenname || 'uns'}!`,
        body: texts.intro?.body || '',
        teaser: texts.intro?.teaser || `Neugierig welche Vorteile dich als ${job.stelle || 'Mitarbeiter:in'} bei uns erwarten?`,
        yes_button: texts.intro?.yes_button || 'Ja klar! 🚀',
        info_button: texts.intro?.info_button || 'Erst mehr Infos bitte ℹ️',
        image_url: oldImages.start || null,
      },
      {
        id: randomUUID(), type: 'benefits',
        headline: texts.benefits?.headline || 'Das erwartet dich bei uns',
        body: texts.benefits?.body || '',
        quote: texts.benefits?.quote || '',
        benefits: benefitsList,
        next_button: texts.benefits?.next_button || 'Und was sind meine Aufgaben? →',
        image_url: null,
      },
      {
        id: randomUUID(), type: 'tasks',
        headline: texts.tasks?.headline || `Deine Aufgaben als ${job.stelle || ''}`,
        intro: texts.tasks?.intro || '',
        aufgaben: Array.isArray(texts.tasks?.aufgaben) ? texts.tasks.aufgaben.filter(Boolean) : [],
        next_button: texts.tasks?.next_button || 'Klingt gut — jetzt bewerben! →',
        image_url: null,
      },
    ];

    // Vorhandene fragen als question-Screens übernehmen (Backwards-Compat)
    const oldFragen = Array.isArray(funnel.fragen) ? funnel.fragen : [];
    for (const f of oldFragen) {
      if (!f.text) continue;
      screens.push({
        id: f.id || randomUUID(),
        type: 'question',
        text: f.text,
        options: Array.isArray(f.options) ? f.options : [],
        image_url: oldImages.frage || null,
      });
    }

    screens.push({
      id: randomUUID(), type: 'contact',
      headline: 'Wie können wir dich erreichen?',
      body: 'Wir melden uns innerhalb von 24h bei dir.',
      submit_button: 'Bewerbung abschicken',
    });

    const { data: updated, error: uErr } = await supabase
      .from('talentone_funnels').update({ screens }).eq('id', funnel.id).select().single();
    if (uErr) return res.status(500).json({ error: uErr.message });
    res.json({ screens: updated.screens, generated: true });
  } catch (err) {
    console.error('[initial-screens]', err.message);
    res.status(503).json({ error: err.message });
  }
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

// POST /api/funnels/:id/crop-image  body: { source_url, crop:{x,y,width,height} }
// Schneidet auf den 16:9-Bereich zu (sharp), uploaded als neue Datei.
router.post('/:id/crop-image', async (req, res) => {
  const { source_url, crop } = req.body || {};
  if (!source_url || !crop) return res.status(400).json({ error: 'source_url + crop benötigt.' });
  try {
    const { data: funnel } = await supabase
      .from('talentone_funnels').select('job_id').eq('id', req.params.id).maybeSingle();
    if (!funnel) return res.status(404).json({ error: 'Funnel nicht gefunden.' });
    const result = await cropFunnelImage(source_url, crop, funnel.job_id);
    res.status(201).json(result);
  } catch (err) {
    console.error('[funnel/crop]', err.message);
    res.status(500).json({ error: err.message });
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
