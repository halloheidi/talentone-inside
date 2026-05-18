import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { supabase } from '../supabase.js';
import {
  streamCreativesZip, streamAdCopiesPdf,
  generateAnschreibensVorschlag, sendEntwurfsMail,
} from '../exports.js';

const router = Router();

const PUBLIC_BASE = process.env.PUBLIC_BASE_URL || 'https://inside.talent-one.de';

// Stellt sicher dass der Job einen review_token hat. Gibt ihn zurück.
async function ensureReviewToken(jobId, existing) {
  if (existing) return existing;
  const token = randomUUID();
  await supabase.from('talentone_jobs').update({ review_token: token }).eq('id', jobId);
  return token;
}

async function loadFullJob(jobId) {
  const { data: job, error: jE } = await supabase
    .from('talentone_jobs').select('*').eq('id', jobId).single();
  if (jE || !job) throw new Error('Job nicht gefunden.');
  const { data: kunde } = await supabase
    .from('talentone_kunden').select('*').eq('id', job.kunde_id).single();
  const { data: creatives = [] } = await supabase
    .from('talentone_creatives').select('*').eq('job_id', jobId).order('created_at', { ascending: false });
  const { data: adcopies = [] } = await supabase
    .from('talentone_adcopies').select('*').eq('job_id', jobId);
  const { data: funnel } = await supabase
    .from('talentone_funnels').select('*').eq('job_id', jobId).order('created_at', { ascending: false }).limit(1).maybeSingle();
  return { job, kunde, creatives, adcopies, funnel };
}

function filterByIds(list, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return list;
  const set = new Set(ids);
  return list.filter(x => set.has(x.id));
}

/* GET /api/jobs/:id/export — Übersichts-Daten für den Export-Tab */
router.get('/jobs/:id/export', async (req, res) => {
  try {
    const data = await loadFullJob(req.params.id);
    // Externer Funnel → externe URL, sonst interne PUBLIC_BASE/f/:id
    const funnelUrl = !data.funnel?.id ? null
      : (data.funnel.extern && data.funnel.extern_url) ? data.funnel.extern_url
      : `${PUBLIC_BASE}/f/${data.funnel.id}`;
    res.json({ ...data, funnel_url: funnelUrl });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

/* POST /api/jobs/:id/export/zip  body: { creative_ids?: [] } — streamt ZIP */
router.post('/jobs/:id/export/zip', async (req, res) => {
  try {
    const { job, kunde, creatives } = await loadFullJob(req.params.id);
    const selected = filterByIds(creatives, req.body?.creative_ids);
    if (selected.length === 0) return res.status(400).json({ error: 'Keine Creatives ausgewählt.' });
    await streamCreativesZip(res, { job, kunde, creatives: selected });
  } catch (err) {
    console.error('[export/zip]', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

/* POST /api/jobs/:id/export/pdf  body: { adcopy_ids?: [] } — streamt PDF */
router.post('/jobs/:id/export/pdf', async (req, res) => {
  try {
    const { job, kunde, adcopies } = await loadFullJob(req.params.id);
    const selected = filterByIds(adcopies, req.body?.adcopy_ids);
    if (selected.length === 0) return res.status(400).json({ error: 'Keine Ad-Copies ausgewählt.' });
    await streamAdCopiesPdf(res, { job, kunde, adcopies: selected });
  } catch (err) {
    console.error('[export/pdf]', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

/* POST /api/jobs/:id/export/anschreiben — Claude-Vorschlag */
router.post('/jobs/:id/export/anschreiben', async (req, res) => {
  try {
    const { job, kunde } = await loadFullJob(req.params.id);
    const text = await generateAnschreibensVorschlag(job, kunde);
    res.json({ text });
  } catch (err) {
    console.error('[export/anschreiben]', err.message);
    res.status(503).json({ error: err.message });
  }
});

/* POST /api/jobs/:id/export/email
   body: { to, betreff, anschreiben, creative_ids, adcopy_ids, include_funnel } */
router.post('/jobs/:id/export/email', async (req, res) => {
  const { to, betreff, anschreiben, creative_ids, adcopy_ids, include_funnel } = req.body || {};
  if (!to?.trim()) return res.status(400).json({ error: 'Empfänger-Mail fehlt.' });

  try {
    const { job, kunde, creatives, adcopies, funnel } = await loadFullJob(req.params.id);
    const selCreatives = filterByIds(creatives, creative_ids);
    const selAdcopies = filterByIds(adcopies, adcopy_ids);
    const funnelUrl = !include_funnel || !funnel?.id ? null
      : (funnel.extern && funnel.extern_url) ? funnel.extern_url
      : `${PUBLIC_BASE}/f/${funnel.id}`;
    const sheetUrl = include_funnel && funnel?.extern_sheet_url ? funnel.extern_sheet_url : null;

    // Review-Token sicherstellen + URL bauen
    const reviewToken = await ensureReviewToken(job.id, job.review_token);
    const reviewUrl = `${PUBLIC_BASE}/review/${reviewToken}`;

    await sendEntwurfsMail({
      to: to.trim(), betreff, anschreiben, job, kunde,
      creatives: selCreatives, adcopies: selAdcopies,
      funnelUrl, sheetUrl, reviewUrl,
    });

    // Historie speichern
    const { error: insErr } = await supabase.from('talentone_versand').insert({
      job_id: job.id,
      empfaenger: to.trim(),
      betreff: betreff || null,
      gesendet_von: req.user?.email || null,
      inhalte: {
        creative_ids: selCreatives.map(c => c.id),
        adcopy_ids: selAdcopies.map(a => a.id),
        funnel_url: funnelUrl,
        anschreiben,
      },
    });
    if (insErr) console.warn('[export/email] Historie-Insert:', insErr.message);

    res.json({ ok: true });
  } catch (err) {
    console.error('[export/email]', err.message);
    res.status(503).json({ error: err.message });
  }
});

/* GET /api/jobs/:id/export/versand — Historie */
router.get('/jobs/:id/export/versand', async (req, res) => {
  const { data, error } = await supabase
    .from('talentone_versand')
    .select('*').eq('job_id', req.params.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ versand: data });
});

/* GET /api/jobs/:id/export/review — neueste Review-Antwort + Status */
router.get('/jobs/:id/export/review', async (req, res) => {
  const { data, error } = await supabase
    .from('talentone_reviews')
    .select('*').eq('job_id', req.params.id)
    .order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ review: data });
});

export default router;
