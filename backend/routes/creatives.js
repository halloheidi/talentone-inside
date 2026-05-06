import { Router } from 'express';
import { supabase } from '../supabase.js';
import {
  generateMotivVorschlaege,
  generateVariant,
  deleteFromStorage,
} from '../imagegen.js';

const router = Router();

/* GET /api/creatives?job_id=… — Galerie für ein Projekt */
router.get('/', async (req, res) => {
  let q = supabase.from('talentone_creatives').select('*').order('created_at', { ascending: false });
  if (req.query.job_id) q = q.eq('job_id', req.query.job_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ creatives: data });
});

/* POST /api/creatives/motiv-vorschlaege  body: { job_id }
   Liefert 3 KI-Motiv-Vorschläge für den Job. */
router.post('/motiv-vorschlaege', async (req, res) => {
  const { job_id } = req.body || {};
  if (!job_id) return res.status(400).json({ error: 'job_id ist Pflicht.' });
  try {
    const { data: job, error: jE } = await supabase.from('talentone_jobs').select('*').eq('id', job_id).single();
    if (jE || !job) return res.status(404).json({ error: 'Job nicht gefunden.' });
    const { data: kunde } = await supabase.from('talentone_kunden').select('*').eq('id', job.kunde_id).single();
    const motive = await generateMotivVorschlaege(job, kunde);
    res.json({ motive });
  } catch (err) {
    console.error('[motiv-vorschlaege]', err.message);
    res.status(503).json({ error: err.message });
  }
});

/* POST /api/creatives/generate  body: { job_id, motiv, varianten?: 1-3 }
   Antwortet SOFORT mit 202 + erwarteter Bilderzahl. Die eigentliche Generierung
   läuft im Hintergrund (gpt-image-2 dauert pro Bild 30-90s, Traefik-Timeout ~180s).
   Frontend pollt /api/creatives?job_id=… und merkt am Anstieg, wenn fertig. */
router.post('/generate', async (req, res) => {
  const { job_id, motiv, varianten = 1, referenzbild_id } = req.body || {};
  if (!job_id) return res.status(400).json({ error: 'job_id ist Pflicht.' });
  if (!motiv?.trim()) return res.status(400).json({ error: 'motiv ist Pflicht.' });
  const n = Math.min(Math.max(parseInt(varianten, 10) || 1, 1), 3);

  // Job + Kunde vorab laden, damit Validation-Fehler sofort kommen.
  const { data: job, error: jE } = await supabase.from('talentone_jobs').select('*').eq('id', job_id).single();
  if (jE || !job) return res.status(404).json({ error: 'Job nicht gefunden.' });
  const { data: kunde } = await supabase.from('talentone_kunden').select('*').eq('id', job.kunde_id).single();

  // Reference-Images zusammenstellen: Logo zuerst, dann optional das gewählte Referenzbild.
  const referenceImages = [];
  if (kunde?.logo_url) referenceImages.push({ url: kunde.logo_url, name: 'logo', isLogo: true });
  if (referenzbild_id) {
    const { data: ref } = await supabase
      .from('talentone_referenzbilder').select('bild_url').eq('id', referenzbild_id).maybeSingle();
    if (ref?.bild_url) referenceImages.push({ url: ref.bild_url, name: 'stil-referenz', isLogo: false });
  }

  const expected = n * 2; // jede Variante × 2 Formate
  res.status(202).json({ accepted: true, expected, message: 'Generierung gestartet — Bilder erscheinen automatisch in der Galerie.' });

  // Hintergrund-Job
  (async () => {
    console.log(`[generate-bg] job ${job_id}, ${n} Varianten (=${expected} Bilder), refs=${referenceImages.length}`);
    try {
      const variantResults = await Promise.all(
        Array.from({ length: n }).map(() => generateVariant({ job, kunde, motiv, referenceImages })),
      );
      const allOk = variantResults.flatMap(v => v.ok);
      const allErrors = variantResults.flatMap(v => v.errors);
      if (allErrors.length) console.warn(`[generate-bg] Teilfehler:`, allErrors);

      if (allOk.length > 0) {
        const rows = allOk.map(({ format, bildUrl, prompt }) => ({
          job_id, format, typ: 'bild', bild_url: bildUrl, prompt, status: 'fertig',
        }));
        const { error: insErr } = await supabase.from('talentone_creatives').insert(rows);
        if (insErr) console.error(`[generate-bg] DB-Insert: ${insErr.message}`);
        else console.log(`[generate-bg] ${allOk.length} Creative(s) für job ${job_id} fertig.`);
      } else {
        console.error(`[generate-bg] Alle Bilder fehlgeschlagen für job ${job_id}`);
      }
    } catch (err) {
      console.error(`[generate-bg] Fehler:`, err.message);
    }
  })().catch(err => console.error('[generate-bg] uncaught:', err));
});

/* POST /api/creatives/:id/regenerate  body: { motiv, referenzbild_id? } — altes Creative löschen + neu im selben Format. */
router.post('/:id/regenerate', async (req, res) => {
  const { motiv, referenzbild_id } = req.body || {};
  if (!motiv?.trim()) return res.status(400).json({ error: 'motiv ist Pflicht.' });
  try {
    const { data: existing, error: e1 } = await supabase
      .from('talentone_creatives')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (e1 || !existing) return res.status(404).json({ error: 'Creative nicht gefunden.' });
    const { data: job } = await supabase.from('talentone_jobs').select('*').eq('id', existing.job_id).single();
    const { data: kunde } = await supabase.from('talentone_kunden').select('*').eq('id', job.kunde_id).single();

    const referenceImages = [];
    if (kunde?.logo_url) referenceImages.push({ url: kunde.logo_url, name: 'logo', isLogo: true });
    if (referenzbild_id) {
      const { data: ref } = await supabase
        .from('talentone_referenzbilder').select('bild_url').eq('id', referenzbild_id).maybeSingle();
      if (ref?.bild_url) referenceImages.push({ url: ref.bild_url, name: 'stil-referenz', isLogo: false });
    }

    const { generateOneCreative } = await import('../imagegen.js');
    const result = await generateOneCreative({ job, kunde, motiv, format: existing.format, referenceImages });

    // Erst neues Creative anlegen, dann altes löschen (Storage + DB)
    const { data: created, error: insErr } = await supabase
      .from('talentone_creatives')
      .insert({
        job_id: existing.job_id,
        format: existing.format,
        typ: 'bild',
        bild_url: result.bildUrl,
        prompt: result.prompt,
        status: 'fertig',
      })
      .select()
      .single();
    if (insErr) return res.status(500).json({ error: insErr.message });

    await deleteFromStorage(existing.bild_url);
    await supabase.from('talentone_creatives').delete().eq('id', existing.id);

    res.status(201).json({ creative: created });
  } catch (err) {
    console.error('[regenerate]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* DELETE /api/creatives/:id — Storage + DB-Zeile löschen. */
router.delete('/:id', async (req, res) => {
  const { data: existing } = await supabase
    .from('talentone_creatives')
    .select('bild_url')
    .eq('id', req.params.id)
    .maybeSingle();
  if (existing?.bild_url) await deleteFromStorage(existing.bild_url);
  const { error } = await supabase.from('talentone_creatives').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

/* POST /api/creatives/:id/reel — Kling AI Video aus Story-Bild.
   Stub: zeigt klare Meldung, falls KLING_API_KEY nicht konfiguriert. */
router.post('/:id/reel', async (req, res) => {
  if (!process.env.KLING_API_KEY) {
    return res.status(501).json({
      error: 'Reel-Generierung noch nicht aktiviert — KLING_API_KEY fehlt im Backend.',
    });
  }
  return res.status(501).json({ error: 'Reel-Integration kommt im nächsten Schritt.' });
});

export default router;
