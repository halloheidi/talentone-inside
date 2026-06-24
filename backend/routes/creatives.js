import { Router } from 'express';
import { supabase } from '../supabase.js';
import {
  generateMotivVorschlaege,
  generateSpruchVorschlaege,
  verbessereSpruch,
  generateVariant,
  deleteFromStorage,
  STORAGE_BUCKET as CREATIVES_BUCKET,
} from '../imagegen.js';
import { uploadBuffer, extFromMime, safeFilenameStem } from '../storage.js';

const router = Router();

const VALID_FORMATS = new Set(['quadrat', 'story', 'sonstiges']);
const VALID_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
const VALID_VIDEO_MIMES = new Set(['video/mp4', 'video/quicktime']);

/* In-Memory-Map für die jüngste Generation-Fehlermeldung pro Job.
   Frontend pollt /api/creatives und bekommt last_generation_error mit, um
   einen klaren Fehler anzuzeigen statt endlos zu warten. */
const lastGenError = new Map(); // job_id -> { error, friendly, ts }

function friendlyOpenAIError(raw) {
  const s = String(raw || '').toLowerCase();
  if (s.includes('billing_hard_limit_reached') || s.includes('billing limit') || s.includes('billing_hard_limit')) {
    return 'OpenAI-Budget aufgebraucht — bitte im Dashboard das Spending-Limit erhöhen (platform.openai.com → Settings → Limits).';
  }
  if (s.includes('insufficient_quota')) {
    return 'OpenAI-Guthaben aufgebraucht — bitte im Dashboard nachladen.';
  }
  if (s.includes('invalid_api_key') || s.includes('incorrect api key') || s.includes('401')) {
    return 'OpenAI-API-Key ungültig — bitte im Backend-ENV prüfen.';
  }
  if (s.includes('rate_limit') || s.includes('429')) {
    return 'OpenAI-Rate-Limit erreicht — bitte 1–2 Minuten warten und nochmal probieren.';
  }
  if (s.includes('content_policy') || s.includes('safety system')) {
    return 'OpenAI hat den Prompt aus Content-Policy-Gründen abgelehnt — bitte Motiv anpassen.';
  }
  if (s.includes('timeout') || s.includes('etimedout')) {
    return 'OpenAI-Anfrage hat zu lange gedauert (Timeout) — bitte erneut probieren.';
  }
  if (s.includes('storage') || s.includes('supabase')) {
    return 'Bild wurde generiert, konnte aber nicht gespeichert werden — Storage-Bucket prüfen.';
  }
  // Fallback: erste paar Worte der Original-Meldung anzeigen
  return `Fehler bei der Bildgenerierung: ${String(raw || '').slice(0, 180)}`;
}

export function recordGenError(jobId, rawError) {
  if (!jobId) return;
  lastGenError.set(jobId, {
    error: String(rawError || '').slice(0, 500),
    friendly: friendlyOpenAIError(rawError),
    ts: Date.now(),
  });
}
export function clearGenError(jobId) {
  if (jobId) lastGenError.delete(jobId);
}
export function getGenError(jobId) {
  return jobId ? lastGenError.get(jobId) || null : null;
}

/* POST /api/creatives/upload  body: { job_id, files: [{ fileData, fileName, contentType, format }] }
   Lädt N fertige Creatives (Bilder/Videos) hoch — gleicher Bucket, gleiche Galerie wie generierte.
   Markiert sie via quelle='upload' damit das Frontend ein "Hochgeladen"-Badge zeigen kann. */
router.post('/upload', async (req, res) => {
  const { job_id, files } = req.body || {};
  if (!job_id) return res.status(400).json({ error: 'job_id ist Pflicht.' });
  if (!Array.isArray(files) || files.length === 0) return res.status(400).json({ error: 'Keine Dateien übergeben.' });

  const inserted = [];
  const errors = [];

  for (const [i, f] of files.entries()) {
    try {
      if (!f?.fileData || !f?.contentType) {
        errors.push({ index: i, error: 'fileData / contentType fehlt.' });
        continue;
      }
      const ct = String(f.contentType).toLowerCase();
      const isImage = VALID_IMAGE_MIMES.has(ct);
      const isVideo = VALID_VIDEO_MIMES.has(ct);
      if (!isImage && !isVideo) {
        errors.push({ index: i, error: `Nicht unterstützter Typ: ${ct}` });
        continue;
      }
      const format = VALID_FORMATS.has(f.format) ? f.format : 'sonstiges';
      const typ = isVideo ? 'video' : 'bild';
      const ext = extFromMime(ct, isVideo ? 'mp4' : 'png');
      const stem = safeFilenameStem(f.fileName);
      const path = `${job_id}/${format}-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${stem}.${ext}`;

      const buffer = Buffer.from(f.fileData, 'base64');
      const bildUrl = await uploadBuffer({ bucket: CREATIVES_BUCKET, path, buffer, contentType: ct });

      const baseRow = { job_id, format, typ, bild_url: bildUrl, status: 'fertig', prompt: null };

      // Erst mit quelle='upload' versuchen — wenn Spalte fehlt, Fallback ohne quelle
      let { data, error: insErr } = await supabase
        .from('talentone_creatives')
        .insert({ ...baseRow, quelle: 'upload' })
        .select().single();
      if (insErr && /column.*quelle.*does not exist|could not find.*quelle/i.test(insErr.message)) {
        console.warn('[creatives/upload] quelle-Spalte fehlt — Fallback ohne quelle. Bitte SQL-Migration anwenden.');
        const retry = await supabase.from('talentone_creatives').insert(baseRow).select().single();
        data = retry.data;
        insErr = retry.error;
      }

      if (insErr) {
        console.error(`[creatives/upload] DB-Insert fehlgeschlagen für ${f.fileName}:`, insErr.message);
        errors.push({ index: i, error: insErr.message });
        continue;
      }
      inserted.push(data);
    } catch (err) {
      console.error(`[creatives/upload] Datei ${i} (${f?.fileName}) fehlgeschlagen:`, err.message);
      errors.push({ index: i, error: err.message });
    }
  }

  if (inserted.length === 0) {
    return res.status(500).json({ error: 'Kein Creative konnte gespeichert werden.', details: errors });
  }
  res.status(201).json({ creatives: inserted, errors: errors.length ? errors : undefined });
});

/* GET /api/creatives?job_id=… — Galerie für ein Projekt
   Liefert zusätzlich last_generation_error, damit das Frontend Polling-Failures
   sieht ohne separates Endpoint. */
router.get('/', async (req, res) => {
  let q = supabase.from('talentone_creatives').select('*').order('created_at', { ascending: false });
  if (req.query.job_id) q = q.eq('job_id', req.query.job_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({
    creatives: data,
    last_generation_error: req.query.job_id ? getGenError(req.query.job_id) : null,
  });
});

/* POST /api/creatives/clear-error — Frontend bestätigt Anzeige des Fehlers,
   damit er nicht beim nächsten Generierungsstart noch übrig ist. */
router.post('/clear-error', (req, res) => {
  const { job_id } = req.body || {};
  if (job_id) clearGenError(job_id);
  res.json({ ok: true });
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

/* POST /api/creatives/spruch-vorschlaege  body: { job_id }
   Liefert 4 Headline-Vorschläge fürs Creative (knappe Curiosity-Sprüche). */
router.post('/spruch-vorschlaege', async (req, res) => {
  const { job_id } = req.body || {};
  if (!job_id) return res.status(400).json({ error: 'job_id ist Pflicht.' });
  try {
    const { data: job, error: jE } = await supabase.from('talentone_jobs').select('*').eq('id', job_id).single();
    if (jE || !job) return res.status(404).json({ error: 'Job nicht gefunden.' });
    const { data: kunde } = await supabase.from('talentone_kunden').select('*').eq('id', job.kunde_id).single();
    const sprueche = await generateSpruchVorschlaege(job, kunde);
    res.json({ sprueche });
  } catch (err) {
    console.error('[spruch-vorschlaege]', err.message);
    res.status(503).json({ error: err.message });
  }
});

/* POST /api/creatives/spruch-verbessern  body: { job_id, spruch }
   Liefert 3 verbesserte Varianten eines bestehenden Spruchs. */
router.post('/spruch-verbessern', async (req, res) => {
  const { job_id, spruch } = req.body || {};
  if (!job_id || !spruch?.trim()) return res.status(400).json({ error: 'job_id und spruch sind Pflicht.' });
  try {
    const { data: job, error: jE } = await supabase.from('talentone_jobs').select('*').eq('id', job_id).single();
    if (jE || !job) return res.status(404).json({ error: 'Job nicht gefunden.' });
    const { data: kunde } = await supabase.from('talentone_kunden').select('*').eq('id', job.kunde_id).single();
    const varianten = await verbessereSpruch({ spruch, job, kunde });
    res.json({ varianten });
  } catch (err) {
    console.error('[spruch-verbessern]', err.message);
    res.status(503).json({ error: err.message });
  }
});

/* POST /api/creatives/generate  body: { job_id, motiv, varianten?: 1-3 }
   Antwortet SOFORT mit 202 + erwarteter Bilderzahl. Die eigentliche Generierung
   läuft im Hintergrund (gpt-image-2 dauert pro Bild 30-90s, Traefik-Timeout ~180s).
   Frontend pollt /api/creatives?job_id=… und merkt am Anstieg, wenn fertig. */
router.post('/generate', async (req, res) => {
  const { job_id, motiv, varianten = 1, mode = 'ki', personenfoto_id, foto_id, spruch } = req.body || {};
  console.log(`[generate] body keys=[${Object.keys(req.body || {}).join(',')}] mode=${mode} job_id=${job_id?.slice(0,8)} personenfoto_id=${personenfoto_id?.slice(0,8) || '–'} foto_id=${foto_id?.slice(0,8) || '–'} varianten=${varianten} spruch="${(spruch||'').slice(0,40)}"`);
  if (!job_id) return res.status(400).json({ error: 'job_id ist Pflicht.' });
  if (!['ki', 'foto'].includes(mode)) return res.status(400).json({ error: 'mode muss "ki" oder "foto" sein.' });
  if (mode === 'ki' && !motiv?.trim()) return res.status(400).json({ error: 'motiv ist Pflicht in Modus "ki".' });
  if (mode === 'foto' && !foto_id) return res.status(400).json({ error: 'foto_id ist Pflicht in Modus "foto".' });
  const n = Math.min(Math.max(parseInt(varianten, 10) || 1, 1), 3);

  // Job + Kunde vorab laden, damit Validation-Fehler sofort kommen.
  const { data: job, error: jE } = await supabase.from('talentone_jobs').select('*').eq('id', job_id).single();
  if (jE || !job) return res.status(404).json({ error: 'Job nicht gefunden.' });
  const { data: kunde } = await supabase.from('talentone_kunden').select('*').eq('id', job.kunde_id).single();

  // Reference-Images zusammenstellen.
  // mode='ki':   Logo (falls vorhanden) zuerst, dann optional Personen-Foto.
  // mode='foto': Logo (falls vorhanden) zuerst, dann VERPFLICHTEND das Hintergrund-Foto.
  const referenceImages = [];
  if (kunde?.logo_url) referenceImages.push({ url: kunde.logo_url, name: 'logo', isLogo: true });

  const refRowId = mode === 'foto' ? foto_id : personenfoto_id;
  if (refRowId) {
    const { data: ref } = await supabase
      .from('talentone_referenzbilder').select('bild_url, beschreibung').eq('id', refRowId).maybeSingle();
    if (ref?.bild_url) referenceImages.push({
      url: ref.bild_url, name: mode === 'foto' ? 'hintergrund' : 'person',
      isLogo: false, beschreibung: ref.beschreibung || null,
    });
  }

  if (mode === 'foto' && !referenceImages.some(r => !r.isLogo)) {
    return res.status(404).json({ error: 'Hintergrund-Foto nicht gefunden.' });
  }

  const expected = n * 2; // jede Variante × 2 Formate
  // Alte Fehlermeldung clearen damit das Frontend nicht den Fehler vom letzten Run sieht
  clearGenError(job_id);
  res.status(202).json({ accepted: true, expected, message: 'Generierung gestartet — Bilder erscheinen automatisch in der Galerie.' });

  // Hintergrund-Job
  (async () => {
    const refSummary = referenceImages.map(r => r.isLogo ? 'logo' : (mode === 'foto' ? 'hintergrund' : 'person')).join('+') || 'keine';
    console.log(`[generate-bg] job ${job_id.slice(0,8)} mode=${mode} varianten=${n} expected=${expected} refs=${refSummary}`);
    try {
      const variantResults = await Promise.all(
        Array.from({ length: n }).map(() => generateVariant({ job, kunde, motiv, mode, referenceImages, spruch })),
      );
      const allOk = variantResults.flatMap(v => v.ok);
      const allErrors = variantResults.flatMap(v => v.errors);
      if (allErrors.length) console.warn(`[generate-bg] Teilfehler:`, allErrors);

      if (allOk.length > 0) {
        const rows = allOk.map(({ format, bildUrl, prompt }) => ({
          job_id, format, typ: 'bild', bild_url: bildUrl, prompt, status: 'fertig',
        }));
        const { error: insErr } = await supabase.from('talentone_creatives').insert(rows);
        if (insErr) {
          console.error(`[generate-bg] DB-Insert: ${insErr.message}`);
          recordGenError(job_id, `DB-Insert fehlgeschlagen: ${insErr.message}`);
        } else {
          console.log(`[generate-bg] ${allOk.length} Creative(s) für job ${job_id} fertig.`);
        }
      } else {
        console.error(`[generate-bg] Alle Bilder fehlgeschlagen für job ${job_id}`);
        recordGenError(job_id, allErrors[0] || 'Alle Generierungsversuche fehlgeschlagen');
      }
    } catch (err) {
      console.error(`[generate-bg] Fehler:`, err.message);
      recordGenError(job_id, err.message);
    }
  })().catch(err => {
    console.error('[generate-bg] uncaught:', err);
    recordGenError(job_id, err.message || String(err));
  });
});

/* POST /api/creatives/:id/regenerate
   body: { motiv?, mode='ki'|'foto', personenfoto_id?, foto_id? }
   Altes Creative löschen + neu im selben Format. */
router.post('/:id/regenerate', async (req, res) => {
  const { motiv, mode = 'ki', personenfoto_id, foto_id } = req.body || {};
  if (!['ki', 'foto'].includes(mode)) return res.status(400).json({ error: 'mode muss "ki" oder "foto" sein.' });
  if (mode === 'ki' && !motiv?.trim()) return res.status(400).json({ error: 'motiv ist Pflicht in Modus "ki".' });
  if (mode === 'foto' && !foto_id) return res.status(400).json({ error: 'foto_id ist Pflicht in Modus "foto".' });

  try {
    const { data: existing, error: e1 } = await supabase
      .from('talentone_creatives').select('*').eq('id', req.params.id).single();
    if (e1 || !existing) return res.status(404).json({ error: 'Creative nicht gefunden.' });
    const { data: job } = await supabase.from('talentone_jobs').select('*').eq('id', existing.job_id).single();
    const { data: kunde } = await supabase.from('talentone_kunden').select('*').eq('id', job.kunde_id).single();

    const referenceImages = [];
    if (kunde?.logo_url) referenceImages.push({ url: kunde.logo_url, name: 'logo', isLogo: true });
    const refRowId = mode === 'foto' ? foto_id : personenfoto_id;
    if (refRowId) {
      const { data: ref } = await supabase
        .from('talentone_referenzbilder').select('bild_url, beschreibung').eq('id', refRowId).maybeSingle();
      if (ref?.bild_url) referenceImages.push({
        url: ref.bild_url, name: mode === 'foto' ? 'hintergrund' : 'person',
        isLogo: false, beschreibung: ref.beschreibung || null,
      });
    }
    if (mode === 'foto' && !referenceImages.some(r => !r.isLogo)) {
      return res.status(404).json({ error: 'Hintergrund-Foto nicht gefunden.' });
    }

    const { generateOneCreative } = await import('../imagegen.js');
    const result = await generateOneCreative({
      job, kunde, motiv, mode, format: existing.format, referenceImages,
    });

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
   Antwortet sofort 202, generiert im Hintergrund (1-3 Min). Fertiges Video erscheint
   als neuer Creative-Eintrag mit typ=video, parent_id=<originalBildId>. */
router.post('/:id/reel', async (req, res) => {
  if (!process.env.KLING_ACCESS_KEY || !process.env.KLING_SECRET_KEY) {
    return res.status(501).json({ error: 'Kling-Keys nicht konfiguriert.' });
  }

  const { data: existing, error } = await supabase
    .from('talentone_creatives').select('*').eq('id', req.params.id).single();
  if (error || !existing) return res.status(404).json({ error: 'Creative nicht gefunden.' });
  if (existing.format !== 'story') return res.status(400).json({ error: 'Reel nur für 9:16-Creatives möglich.' });
  if (existing.typ === 'video') return res.status(400).json({ error: 'Quelle muss ein Bild sein, kein Video.' });
  if (!existing.bild_url) return res.status(400).json({ error: 'Keine Bild-URL am Creative.' });

  res.status(202).json({
    accepted: true,
    message: 'Reel-Generierung gestartet — kann 1-3 Minuten dauern. Das Video erscheint automatisch in der Galerie.',
  });

  (async () => {
    try {
      const { generateReelFromImage } = await import('../kling.js');
      const { url } = await generateReelFromImage({
        imageUrl: existing.bild_url,
        prompt: 'Subtle cinematic motion, gentle camera movement, keep all text and overlay elements perfectly stable and sharp',
        jobId: existing.job_id,
      });

      const { error: insErr } = await supabase.from('talentone_creatives').insert({
        job_id: existing.job_id,
        format: 'story',
        typ: 'video',
        bild_url: url,
        prompt: `Kling Reel aus Creative ${existing.id}`,
        status: 'fertig',
        parent_id: existing.id,
      });
      if (insErr) console.error('[reel-bg] DB-Insert:', insErr.message);
      else console.log(`[reel-bg] Reel fertig für creative ${existing.id.slice(0, 8)}`);
    } catch (err) {
      console.error('[reel-bg]', err.message);
    }
  })().catch(err => console.error('[reel-bg] uncaught:', err));
});

export default router;
