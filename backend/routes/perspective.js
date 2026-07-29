// Perspective-Integration im Funnel-Tab.
// Fluss:
//   POST /api/perspective/create        {job_id, schema, website_domain?}
//     -> Brand-check/-create + create_funnel + Storage (persp_status='polling')
//     -> Response 202 { funnel_row_id, perspective_job_id }
//   GET  /api/perspective/status/:funnel_row_id
//     -> pollt get_funnel_job_status, aktualisiert Row bei Completed
//   POST /api/perspective/publish       {funnel_row_id, domain_id?, slug}
//     -> publish_funnel, schreibt live_url + extern=true
//   POST /api/perspective/update        {funnel_row_id, prompt}
//     -> update_funnel, neuer polling-Zyklus
//   GET  /api/perspective/domains
//     -> list_domains
//   PATCH /api/perspective/checklist/:funnel_row_id
//     -> {manual_pixel_done?, manual_webhook_done?}

import { Router } from 'express';
import { supabase } from '../supabase.js';
import {
  findOrCreateBrandForKunde, createFunnel, getFunnelJobStatus,
  publishFunnel, updateFunnel, listDomains, buildRecruitingPrompt, slugify,
} from '../perspective.js';

const router = Router();

/**
 * POST /api/perspective/create
 * body: { job_id, schema?: 'lang'|'kurz', website_domain?: string }
 * Antwort: { funnel_row_id, perspective_job_id, brand_id }
 */
router.post('/create', async (req, res) => {
  const { job_id, schema = 'lang', website_domain } = req.body || {};
  if (!job_id) return res.status(400).json({ error: 'job_id fehlt.' });

  try {
    const { data: job } = await supabase.from('talentone_jobs')
      .select('*').eq('id', job_id).maybeSingle();
    if (!job) return res.status(404).json({ error: 'Job nicht gefunden.' });
    const { data: kunde } = await supabase.from('talentone_kunden')
      .select('*').eq('id', job.kunde_id).maybeSingle();
    if (!kunde) return res.status(404).json({ error: 'Kunde nicht gefunden.' });

    // Domain am Kunden speichern, wenn im Request mitgeschickt (User-Editable im Modal).
    let kundenMitDomain = kunde;
    if (website_domain && website_domain.trim() && website_domain !== kunde.website_domain) {
      const { data: upd } = await supabase.from('talentone_kunden')
        .update({ website_domain: website_domain.trim() }).eq('id', kunde.id)
        .select().single();
      if (upd) kundenMitDomain = upd;
    }

    // 1. Brand ermitteln / erstellen
    const { brand_id, created: brandCreated } = await findOrCreateBrandForKunde(kundenMitDomain);
    if (brandCreated && brand_id !== kundenMitDomain.perspective_brand_id) {
      await supabase.from('talentone_kunden')
        .update({ perspective_brand_id: brand_id }).eq('id', kundenMitDomain.id);
    }

    // 2. Referenzbilder + fertige Creatives einsammeln (letzte 6, nicht-archivierte)
    const [{ data: refs = [] }, { data: creatives = [] }] = await Promise.all([
      supabase.from('talentone_referenzbilder').select('bild_url')
        .eq('kunde_id', kunde.id).limit(6),
      supabase.from('talentone_creatives').select('bild_url')
        .eq('job_id', job.id).neq('archiviert', true).eq('typ', 'bild').limit(6),
    ]);
    const bildUrls = [...refs, ...creatives].map(r => r.bild_url).filter(Boolean).slice(0, 8);

    // 3. Prompt bauen
    const prompt = buildRecruitingPrompt({ job, kunde: kundenMitDomain, schema, bildUrls });
    const funnelName = `${kundenMitDomain.firmenname} — ${job.stelle || 'Recruiting-Funnel'}`.slice(0, 120);

    // 4. Funnel-Row anlegen ODER die (per Typ-Auswahl vorab angelegte) Row
    //    wiederverwenden — sonst entstehen zwei Funnel-Rows pro Job.
    const { data: bestehendeRow } = await supabase.from('talentone_funnels')
      .select('id').eq('job_id', job.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    const rowPatch = {
      job_id: job.id,
      extern: false,
      funnel_typ: 'perspective',
      perspective_status: 'creating',
      perspective_schema: schema,
      perspective_prompt: prompt,
    };
    let funnelRow, fErr;
    if (bestehendeRow) {
      ({ data: funnelRow, error: fErr } = await supabase.from('talentone_funnels')
        .update(rowPatch).eq('id', bestehendeRow.id).select().single());
    } else {
      ({ data: funnelRow, error: fErr } = await supabase.from('talentone_funnels')
        .insert(rowPatch).select().single());
    }
    if (fErr) return res.status(500).json({ error: `Funnel-Row: ${fErr.message}` });

    // 5. create_funnel triggern (blockend, aber schnell — nur job_id abholen)
    let perspective_job_id;
    try {
      const created = await createFunnel({ brand_id, name: funnelName, prompt });
      perspective_job_id = created.job_id;
      await supabase.from('talentone_funnels').update({
        perspective_job_id, perspective_status: 'polling',
      }).eq('id', funnelRow.id);
    } catch (err) {
      await supabase.from('talentone_funnels').update({
        perspective_status: 'error', perspective_last_error: err.message,
      }).eq('id', funnelRow.id);
      return res.status(502).json({ error: `Perspective create_funnel: ${err.message}`, funnel_row_id: funnelRow.id });
    }

    res.status(202).json({ funnel_row_id: funnelRow.id, perspective_job_id, brand_id });
  } catch (err) {
    console.error('[perspective/create]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/perspective/status/:funnel_row_id
 * Pollt einmal, aktualisiert Row wenn "completed" oder "error".
 * Antwort: { status, editor_url?, live_url? }
 */
router.get('/status/:funnel_row_id', async (req, res) => {
  try {
    const { data: row } = await supabase.from('talentone_funnels')
      .select('*').eq('id', req.params.funnel_row_id).maybeSingle();
    if (!row) return res.status(404).json({ error: 'Funnel nicht gefunden.' });
    if (row.perspective_status === 'completed') {
      return res.json({ status: 'completed', editor_url: row.perspective_editor_url });
    }
    if (row.perspective_status === 'error') {
      return res.json({ status: 'error', error: row.perspective_last_error });
    }
    if (!row.perspective_job_id) return res.json({ status: row.perspective_status || 'unknown' });

    let poll;
    try { poll = await getFunnelJobStatus(row.perspective_job_id); }
    catch (err) { return res.status(502).json({ status: 'polling', error: err.message }); }

    const patch = {};
    if (['completed', 'success', 'ready'].includes((poll.status || '').toLowerCase())) {
      patch.perspective_status = 'completed';
      if (poll.funnel_id) patch.perspective_funnel_id = poll.funnel_id;
      if (poll.editor_url) patch.perspective_editor_url = poll.editor_url;
      else if (poll.funnel_id) patch.perspective_editor_url = `https://app.perspective.co/funnel/${poll.funnel_id}`;
    } else if ((poll.status || '').toLowerCase() === 'failed' || (poll.status || '').toLowerCase() === 'error') {
      patch.perspective_status = 'error';
      patch.perspective_last_error = poll.error || 'Unbekannter Fehler in Perspective.';
    } else {
      patch.perspective_status = 'polling';
    }
    if (Object.keys(patch).length) {
      await supabase.from('talentone_funnels').update(patch).eq('id', row.id);
    }
    res.json({
      status: patch.perspective_status || row.perspective_status || 'polling',
      editor_url: patch.perspective_editor_url || row.perspective_editor_url || null,
      error: patch.perspective_last_error || null,
    });
  } catch (err) {
    console.error('[perspective/status]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/perspective/publish
 * body: { funnel_row_id, domain_id?, slug }
 */
router.post('/publish', async (req, res) => {
  const { funnel_row_id, domain_id, slug } = req.body || {};
  if (!funnel_row_id || !slug) return res.status(400).json({ error: 'funnel_row_id und slug sind Pflicht.' });

  try {
    const { data: row } = await supabase.from('talentone_funnels')
      .select('*').eq('id', funnel_row_id).maybeSingle();
    if (!row || !row.perspective_funnel_id) return res.status(404).json({ error: 'Perspective-Funnel nicht gefunden.' });

    // TalentOne-Default: PERSPECTIVE_DOMAIN_ID_TALENTONE aus ENV wenn keine Domain gewaehlt.
    const finalDomain = domain_id || process.env.PERSPECTIVE_DOMAIN_ID_TALENTONE || null;
    const { live_url } = await publishFunnel({
      funnel_id: row.perspective_funnel_id,
      domain_id: finalDomain,
      slug: slugify(slug),
    });

    const { data: updated } = await supabase.from('talentone_funnels').update({
      extern: true,
      extern_url: live_url,
      veroeffentlicht: true,
      perspective_meta: { ...(row.perspective_meta || {}), live_url, domain_id: finalDomain, slug: slugify(slug) },
    }).eq('id', row.id).select().single();

    res.json({ live_url, funnel: updated });
  } catch (err) {
    console.error('[perspective/publish]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/perspective/update
 * body: { funnel_row_id, prompt }
 * Setzt perspective_status=polling, neuer job_id
 */
router.post('/update', async (req, res) => {
  const { funnel_row_id, prompt } = req.body || {};
  if (!funnel_row_id || !prompt?.trim()) return res.status(400).json({ error: 'funnel_row_id und prompt sind Pflicht.' });
  try {
    const { data: row } = await supabase.from('talentone_funnels')
      .select('*').eq('id', funnel_row_id).maybeSingle();
    if (!row?.perspective_funnel_id) return res.status(404).json({ error: 'Perspective-Funnel nicht gefunden.' });
    const { job_id } = await updateFunnel({ funnel_id: row.perspective_funnel_id, prompt: prompt.trim() });
    await supabase.from('talentone_funnels').update({
      perspective_job_id: job_id,
      perspective_status: 'polling',
      perspective_last_error: null,
    }).eq('id', row.id);
    res.status(202).json({ perspective_job_id: job_id });
  } catch (err) {
    console.error('[perspective/update]', err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/perspective/domains */
router.get('/domains', async (req, res) => {
  try {
    const domains = await listDomains();
    res.json({ domains });
  } catch (err) {
    console.error('[perspective/domains]', err);
    res.status(500).json({ error: err.message });
  }
});

/** PATCH /api/perspective/checklist/:funnel_row_id  body: {manual_pixel_done?, manual_webhook_done?} */
router.patch('/checklist/:funnel_row_id', async (req, res) => {
  const patch = {};
  if (req.body?.manual_pixel_done !== undefined)   patch.manual_pixel_done = !!req.body.manual_pixel_done;
  if (req.body?.manual_webhook_done !== undefined) patch.manual_webhook_done = !!req.body.manual_webhook_done;
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Kein Feld im Body.' });
  const { data, error } = await supabase.from('talentone_funnels')
    .update(patch).eq('id', req.params.funnel_row_id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ funnel: data });
});

/** GET /api/perspective/config → { enabled }
 *  Ob die Perspective-MCP-Integration scharf ist (Token gesetzt). Steuert im
 *  Funnel-Tab, ob der Create-Button oder ein Hinweis (Claude-Workflow) erscheint. */
router.get('/config', (req, res) => {
  res.json({ enabled: !!process.env.PERSPECTIVE_MCP_TOKEN });
});

export default router;
