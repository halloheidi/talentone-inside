import { Router } from 'express';
import { supabase } from '../supabase.js';
import {
  generateMotivVorschlaege,
  generateSpruchVorschlaege,
  verbessereSpruch,
  generateVariant,
  generateGezielteAenderung,
  neuerHookAusWunsch,
  willLogoImMotiv,
  deleteFromStorage,
  STORAGE_BUCKET as CREATIVES_BUCKET,
} from '../imagegen.js';
import { uploadBuffer, extFromMime, safeFilenameStem, fetchAsBuffer } from '../storage.js';
import { generateOverlays } from '../overlay-renderer.js';
import { makeTransparent, composeLogoOverlay } from '../logo.js';
import { UnsupportedImageError } from '../imageops.js';

// ─────────────── Logo-Layer neu rendern (geteilt) ───────────────
// Kern des Logo-Tauschs: Basisbild + AKTUELLES Logo neu kompositieren, ohne das
// KI-Bild neu zu generieren. Genutzt von PATCH /:id/logo-position (einzeln,
// mit neuer Position) UND von POST /logo-refresh (Batch, mit gespeicherter
// Position). Ein Creative ist nur tauschbar, wenn bild_ohne_logo_url existiert.

// Holt das transparente Logo des Kunden — bevorzugt aus logo_transparent_url,
// sonst on-the-fly aus logo_url und (best-effort) persistiert. Einmal pro Batch
// aufrufen, dann fuer alle Creatives wiederverwenden.
async function resolveTransparentLogo(kunde) {
  if (kunde.logo_transparent_url) {
    try { return (await fetchAsBuffer(kunde.logo_transparent_url)).buffer; }
    catch (err) { console.warn('[logo-refresh] transparent-URL nicht ladbar, regeneriere:', err.message); }
  }
  const { buffer: origBuf } = await fetchAsBuffer(kunde.logo_url);
  const transparent = await makeTransparent(origBuf);
  try {
    const path = `${kunde.id}/transparent-${Date.now()}.png`;
    const publicUrl = await uploadBuffer({ bucket: 'talentone-logos', path, buffer: transparent, contentType: 'image/png' });
    await supabase.from('talentone_kunden').update({ logo_transparent_url: publicUrl }).eq('id', kunde.id);
  } catch (err) { console.warn('[logo-refresh] transparent-Upload skip:', err.message); }
  return transparent;
}

// Rendert EIN Bild-Creative neu (Basis + transparentes Logo an position),
// ersetzt bild_url in-place, loescht das alte Bild. position: gespeicherte
// logo_position oder null (=> Default oben rechts). Gibt die neue Row zurueck.
async function relogoBildCreative(existing, transparentLogo) {
  const base = await fetchAsBuffer(existing.bild_ohne_logo_url);
  const composed = await composeLogoOverlay(base.buffer, transparentLogo, existing.logo_position || {});
  const path = `${existing.job_id}/${existing.format}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const newUrl = await uploadBuffer({ bucket: CREATIVES_BUCKET, path, buffer: composed, contentType: 'image/png' });

  const { data: updated, error: uErr } = await supabase.from('talentone_creatives')
    .update({ bild_url: newUrl }).eq('id', existing.id).select().single();
  if (uErr) throw new Error(uErr.message);

  // Altes Bild aufraeumen — aber nie das Basisbild (das brauchen wir weiter).
  const oldUrl = existing.bild_url;
  if (oldUrl && oldUrl !== existing.bild_ohne_logo_url && oldUrl !== newUrl) {
    await deleteFromStorage(oldUrl).catch(() => {});
  }
  return updated;
}

// Overlay-Modus (typ='overlay'): kein Basisbild — das HTML/Playwright-Overlay
// wird neu gerendert (nutzt kunde.logo_url live). Hook steckt im prompt-String
// ("Overlay · Hook: \"…\""); Benefits werden nicht persistiert -> best effort.
async function relogoOverlayCreative(existing, job, kunde) {
  const hook = (existing.prompt || '').match(/Hook:\s*"([^"]*)"/)?.[1] || '';
  const fmt = existing.format === 'story' ? '9:16' : '1:1';
  const overlays = await generateOverlays({ job, kunde, spruch: hook, benefits: null, formats: [fmt] });
  const match = overlays.find(o => o.format === fmt) || overlays[0];
  if (!match?.bild_url) throw new Error('Overlay-Render lieferte kein Bild.');

  const { data: updated, error: uErr } = await supabase.from('talentone_creatives')
    .update({ bild_url: match.bild_url }).eq('id', existing.id).select().single();
  if (uErr) throw new Error(uErr.message);

  const oldUrl = existing.bild_url;
  if (oldUrl && oldUrl !== match.bild_url) await deleteFromStorage(oldUrl).catch(() => {});
  return updated;
}

const router = Router();

const VALID_FORMATS = new Set(['quadrat', 'story', 'sonstiges']);
const VALID_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
const VALID_VIDEO_MIMES = new Set(['video/mp4', 'video/quicktime']);

/* In-Memory-Map für die jüngste Generation-Fehlermeldung pro Job.
   Frontend pollt /api/creatives und bekommt last_generation_error mit, um
   einen klaren Fehler anzuzeigen statt endlos zu warten. */
const lastGenError = new Map(); // job_id -> { error, friendly, ts }

// Nimmt einen Error ODER einen String — die Aufrufer unten uebergeben beides.
function friendlyOpenAIError(raw) {
  // Unser eigener Normalisierungs-Fehler bringt die Nutzer-Meldung schon mit.
  if (raw instanceof UnsupportedImageError) return raw.userMessage;

  const s = String(raw?.message || raw || '').toLowerCase();
  if (s.includes('invalid_image') || s.includes('invalid image') || s.includes('unsupported image')) {
    // Sollte nach der Normalisierung in imageops.js nicht mehr auftreten:
    // HEIC/CMYK/Uebergroesse werden vor dem Upload abgefangen. Wenn OpenAI das
    // Bild trotzdem ablehnt, ist die Datei selbst defekt — "nochmal probieren"
    // waere hier ein falscher Rat.
    return 'Ein Referenzbild wurde von OpenAI abgelehnt. Format und Größe werden vor dem Upload automatisch konvertiert — die Datei ist daher vermutlich beschädigt. Bitte das Referenzbild austauschen.';
  }
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
  return `Fehler bei der Bildgenerierung: ${String(raw?.message || raw || '').slice(0, 180)}`;
}

export function recordGenError(jobId, rawError) {
  if (!jobId) return;
  lastGenError.set(jobId, {
    error: String(rawError?.message || rawError || '').slice(0, 500),
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

/* GET /api/creatives?job_id=…&archived=true — Galerie für ein Projekt.
   Default: NUR aktive Creatives (archiviert=false). Mit `archived=true` als
   Query-Parameter werden ausschließlich archivierte zurückgegeben — Basis für
   die Archiv-Ansicht.
   Liefert zusätzlich last_generation_error, damit das Frontend Polling-Failures
   sieht ohne separates Endpoint. */
router.get('/', async (req, res) => {
  const archivedOnly = String(req.query.archived || '').toLowerCase() === 'true';
  let q = supabase.from('talentone_creatives').select('*').order('created_at', { ascending: false });
  if (req.query.job_id) q = q.eq('job_id', req.query.job_id);
  q = q.eq('archiviert', archivedOnly);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // parent_created_at anreichern — fuer den Hinweis "ersetzt Version vom [Datum]"
  // bei gezielt geaenderten Versionen. Der Parent kann archiviert (also nicht in
  // dieser Liste) sein, daher separat nachladen.
  const parentIds = [...new Set((data || []).map(c => c.parent_id).filter(Boolean))];
  let parentMap = {};
  if (parentIds.length) {
    const { data: parents } = await supabase.from('talentone_creatives')
      .select('id, created_at').in('id', parentIds);
    parentMap = Object.fromEntries((parents || []).map(p => [p.id, p.created_at]));
  }
  const creatives = (data || []).map(c => ({
    ...c,
    parent_created_at: c.parent_id ? (parentMap[c.parent_id] || null) : null,
  }));

  res.json({
    creatives,
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

/* POST /api/creatives/spruch-vorschlaege
   body: { job_id, bild_url?, kontext_hinweis?, motiv? }
   Liefert 4 Headlines. Wenn bild_url gesetzt: Claude Vision analysiert
   das Bild und schlägt szenen-passende Sprüche vor.
   Akzeptiert auch bild_url als talentone_referenzbilder.id (UUID) → wir
   schlagen die bild_url dann selber nach. */
router.post('/spruch-vorschlaege', async (req, res) => {
  const { job_id, bild_url, referenzbild_id, kontext_hinweis, motiv } = req.body || {};
  if (!job_id) return res.status(400).json({ error: 'job_id ist Pflicht.' });
  try {
    const { data: job, error: jE } = await supabase.from('talentone_jobs').select('*').eq('id', job_id).single();
    if (jE || !job) return res.status(404).json({ error: 'Job nicht gefunden.' });
    const { data: kunde } = await supabase.from('talentone_kunden').select('*').eq('id', job.kunde_id).single();

    // Wenn nur eine Referenzbild-ID kam, URL nachschlagen
    let resolvedBildUrl = bild_url || null;
    if (!resolvedBildUrl && referenzbild_id) {
      const { data: ref } = await supabase
        .from('talentone_referenzbilder').select('bild_url').eq('id', referenzbild_id).maybeSingle();
      resolvedBildUrl = ref?.bild_url || null;
    }

    const sprueche = await generateSpruchVorschlaege(job, kunde, {
      bildUrl: resolvedBildUrl,
      kontextHinweis: kontext_hinweis,
      motiv,
    });
    res.json({ sprueche, used_vision: !!resolvedBildUrl });
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
  const { job_id, motiv, varianten = 1, mode = 'ki', personenfoto_id, foto_id, spruch, stilvorlage_id, benefits, logo_auf_kleidung, logo_kleidung_modus } = req.body || {};
  // Logo aufs Motiv (Kleidung/Fahrzeug): expliziter Toggle ODER aus dem Motiv erkannt.
  const logoAufKleidung = logo_auf_kleidung === true || willLogoImMotiv(motiv || '');
  // Modus: 'icon' = nur Bildzeichen; sonst 'voll' (komplettes Logo inkl. Schriftzug).
  const logoModus = logo_kleidung_modus === 'icon' ? 'icon' : 'voll';
  console.log(`[generate] body keys=[${Object.keys(req.body || {}).join(',')}] mode=${mode} job_id=${job_id?.slice(0,8)} personenfoto_id=${personenfoto_id?.slice(0,8) || '–'} foto_id=${foto_id?.slice(0,8) || '–'} varianten=${varianten} spruch="${(spruch||'').slice(0,40)}"`);
  if (!job_id) return res.status(400).json({ error: 'job_id ist Pflicht.' });
  if (!['ki', 'foto', 'overlay'].includes(mode)) return res.status(400).json({ error: 'mode muss "ki", "foto" oder "overlay" sein.' });
  if (mode === 'ki' && !motiv?.trim()) return res.status(400).json({ error: 'motiv ist Pflicht in Modus "ki".' });
  if (mode === 'foto' && !foto_id) return res.status(400).json({ error: 'foto_id ist Pflicht in Modus "foto".' });
  if (mode === 'overlay' && !spruch?.trim()) return res.status(400).json({ error: 'spruch ist Pflicht in Modus "overlay".' });
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

  // Stilvorlage laden (optional). Wenn keine gewählt: default = "Job-Block unten"
  // (die erste aktive nach reihenfolge). Fallback = null → alter Standard-Prompt.
  let stilvorlage = null;
  if (stilvorlage_id) {
    const { data } = await supabase.from('talentone_stilvorlagen')
      .select('*').eq('id', stilvorlage_id).maybeSingle();
    stilvorlage = data || null;
  } else {
    const { data } = await supabase.from('talentone_stilvorlagen')
      .select('*').eq('aktiv', true).order('reihenfolge', { ascending: true }).limit(1).maybeSingle();
    stilvorlage = data || null;
  }

  // Stil-Vorlage als zusätzliches Referenzbild (LETZTES im image[]) — nur wenn die
  // Vorlage ein Beispielbild hat und referenzbild_nutzen aktiv ist.
  if (stilvorlage?.referenzbild_nutzen && stilvorlage?.vorschau_url) {
    referenceImages.push({ url: stilvorlage.vorschau_url, name: 'stilbeispiel', isLogo: false, isStyle: true });
  }

  const expected = n * 2; // jede Variante × 2 Formate
  // Alte Fehlermeldung clearen damit das Frontend nicht den Fehler vom letzten Run sieht
  clearGenError(job_id);
  res.status(202).json({ accepted: true, expected, message: 'Generierung gestartet — Bilder erscheinen automatisch in der Galerie.' });

  // ── Overlay-Modus laeuft komplett getrennt (kein OpenAI, kein KI-Bild) ──
  if (mode === 'overlay') {
    (async () => {
      console.log(`[generate-bg] job ${job_id.slice(0,8)} mode=overlay varianten=${n}`);
      try {
        const allRows = [];
        for (let i = 0; i < n; i++) {
          const overlays = await generateOverlays({
            job, kunde, spruch,
            benefits: Array.isArray(benefits) && benefits.length ? benefits : null,
            formats: ['1:1', '9:16'],
          });
          for (const o of overlays) {
            allRows.push({
              job_id,
              format: o.format === '1:1' ? 'quadrat' : 'story',
              typ: 'overlay',
              bild_url: o.bild_url,
              status: 'fertig',
              prompt: `Overlay · Hook: "${spruch}"`,
            });
          }
        }
        if (allRows.length) {
          const { error: insErr } = await supabase.from('talentone_creatives').insert(allRows);
          if (insErr) recordGenError(job_id, `DB-Insert fehlgeschlagen: ${insErr.message}`);
          else console.log(`[generate-bg] ${allRows.length} Overlay(s) fuer job ${job_id} fertig.`);
        } else {
          recordGenError(job_id, 'Kein Overlay konnte gerendert werden.');
        }
      } catch (err) {
        console.error('[generate-bg overlay]', err);
        recordGenError(job_id, err);
      }
    })().catch(err => {
      console.error('[generate-bg overlay uncaught]', err);
      recordGenError(job_id, err);
    });
    return;
  }

  // Hintergrund-Job
  (async () => {
    const refSummary = referenceImages.map(r => r.isLogo ? 'logo' : (mode === 'foto' ? 'hintergrund' : 'person')).join('+') || 'keine';
    console.log(`[generate-bg] job ${job_id.slice(0,8)} mode=${mode} varianten=${n} expected=${expected} refs=${refSummary}`);
    try {
      const variantResults = await Promise.all(
        Array.from({ length: n }).map(() => generateVariant({ job, kunde, motiv, mode, referenceImages, spruch, stilvorlage, logoAufKleidung, logoModus })),
      );
      const allOk = variantResults.flatMap(v => v.ok);
      const allErrors = variantResults.flatMap(v => v.errors);
      if (allErrors.length) console.warn(`[generate-bg] Teilfehler:`, allErrors);

      if (allOk.length > 0) {
        const rows = allOk.map(({ format, bildUrl, prompt, bildOhneLogoUrl }) => ({
          job_id, format, typ: 'bild', bild_url: bildUrl,
          bild_ohne_logo_url: bildOhneLogoUrl || null,
          prompt, status: 'fertig',
          stilvorlage_id: stilvorlage?.id || null,
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
      recordGenError(job_id, err);
    }
  })().catch(err => {
    console.error('[generate-bg] uncaught:', err);
    recordGenError(job_id, err);
  });
});

/* POST /api/creatives/:id/regenerate
   body: { motiv?, mode='ki'|'foto', personenfoto_id?, foto_id? }
   Altes Creative löschen + neu im selben Format. */
router.post('/:id/regenerate', async (req, res) => {
  const { motiv, mode = 'ki', personenfoto_id, foto_id, stilvorlage_id } = req.body || {};
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

    // Stilvorlage: explizit gewaehlt > vorherige des Creatives > NULL
    const vorlageId = stilvorlage_id !== undefined ? stilvorlage_id : existing.stilvorlage_id;
    let stilvorlage = null;
    if (vorlageId) {
      const { data } = await supabase.from('talentone_stilvorlagen')
        .select('*').eq('id', vorlageId).maybeSingle();
      stilvorlage = data || null;
    }
    // Stil-Vorlage als zusätzliches (letztes) Referenzbild, wenn aktiviert.
    if (stilvorlage?.referenzbild_nutzen && stilvorlage?.vorschau_url) {
      referenceImages.push({ url: stilvorlage.vorschau_url, name: 'stilbeispiel', isLogo: false, isStyle: true });
    }

    const { generateOneCreative } = await import('../imagegen.js');
    const result = await generateOneCreative({
      job, kunde, motiv, mode, format: existing.format, referenceImages, stilvorlage,
    });

    // Erst neues Creative anlegen, dann altes löschen (Storage + DB)
    const { data: created, error: insErr } = await supabase
      .from('talentone_creatives')
      .insert({
        job_id: existing.job_id,
        format: existing.format,
        typ: 'bild',
        bild_url: result.bildUrl,
        bild_ohne_logo_url: result.bildOhneLogoUrl || null,
        prompt: result.prompt,
        status: 'fertig',
        stilvorlage_id: stilvorlage?.id || null,
      })
      .select()
      .single();
    if (insErr) return res.status(500).json({ error: insErr.message });

    await deleteFromStorage(existing.bild_url);
    if (existing.bild_ohne_logo_url) await deleteFromStorage(existing.bild_ohne_logo_url);
    await supabase.from('talentone_creatives').delete().eq('id', existing.id);

    res.status(201).json({ creative: created });
  } catch (err) {
    console.error('[regenerate]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* POST /api/creatives/:id/archivieren — archiviert=true.
   Standard-Weg zum „Entfernen" aus der Galerie. Bild bleibt in Storage + DB. */
router.post('/:id/archivieren', async (req, res) => {
  const { data, error } = await supabase.from('talentone_creatives')
    .update({ archiviert: true }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ creative: data });
});

/* POST /api/creatives/:id/wiederherstellen — archiviert=false.
   Aus der Archiv-Ansicht zurück in die aktive Galerie. */
router.post('/:id/wiederherstellen', async (req, res) => {
  const { data, error } = await supabase.from('talentone_creatives')
    .update({ archiviert: false }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ creative: data });
});

/* DELETE /api/creatives/:id — Endgültig löschen (Storage + DB-Zeile).
   Nur zulässig für BEREITS ARCHIVIERTE Creatives, damit ein versehentliches
   Verwerfen aktiver Bilder nicht möglich ist. */
router.delete('/:id', async (req, res) => {
  const { data: existing } = await supabase
    .from('talentone_creatives')
    .select('bild_url, bild_ohne_logo_url, archiviert')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Creative nicht gefunden.' });
  if (existing.archiviert !== true) {
    return res.status(409).json({
      error: 'Endgültiges Löschen nur für archivierte Creatives. Bitte zuerst archivieren.',
    });
  }
  if (existing.bild_url) await deleteFromStorage(existing.bild_url);
  if (existing.bild_ohne_logo_url) await deleteFromStorage(existing.bild_ohne_logo_url);
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

/* PATCH /api/creatives/:id/logo-position
   body: { x?, y?, width_pct? }  — Werte 0..1, x/y = Zentrum des Logos.
   Rendert das Creative aus bild_ohne_logo_url + kunden.logo_transparent_url
   neu; ersetzt bild_url + speichert logo_position. */
router.patch('/:id/logo-position', async (req, res) => {
  const { x, y, width_pct } = req.body || {};
  const position = {};
  if (x != null) position.x = Number(x);
  if (y != null) position.y = Number(y);
  if (width_pct != null) position.width_pct = Number(width_pct);
  for (const k of Object.keys(position)) {
    if (!Number.isFinite(position[k]) || position[k] < 0 || position[k] > 1) {
      return res.status(400).json({ error: `${k} muss Zahl zwischen 0 und 1 sein.` });
    }
  }

  const { data: existing, error: e1 } = await supabase
    .from('talentone_creatives').select('*').eq('id', req.params.id).single();
  if (e1 || !existing) return res.status(404).json({ error: 'Creative nicht gefunden.' });
  if (!existing.bild_ohne_logo_url) {
    return res.status(409).json({ error: 'Kein Roh-Bild (bild_ohne_logo_url) gespeichert — Logo-Position lässt sich für dieses Creative nicht nachjustieren. Bitte neu generieren.' });
  }

  const { data: job } = await supabase.from('talentone_jobs').select('kunde_id').eq('id', existing.job_id).single();
  const { data: kunde } = await supabase.from('talentone_kunden')
    .select('id, logo_url, logo_transparent_url').eq('id', job.kunde_id).single();
  if (!kunde?.logo_url) return res.status(400).json({ error: 'Kunde hat kein Logo hinterlegt.' });

  try {
    const transparentLogo = await resolveTransparentLogo(kunde);
    const base = await fetchAsBuffer(existing.bild_ohne_logo_url);
    const composed = await composeLogoOverlay(base.buffer, transparentLogo, position);

    // Neues Bild uploaden, altes ersetzen
    const path = `${existing.job_id}/${existing.format}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const newUrl = await uploadBuffer({
      bucket: CREATIVES_BUCKET, path, buffer: composed, contentType: 'image/png',
    });
    const oldUrl = existing.bild_url;

    const { data: updated, error: uErr } = await supabase.from('talentone_creatives')
      .update({ bild_url: newUrl, logo_position: position })
      .eq('id', existing.id).select().single();
    if (uErr) return res.status(500).json({ error: uErr.message });

    if (oldUrl && oldUrl !== existing.bild_ohne_logo_url) await deleteFromStorage(oldUrl);

    res.json({ creative: updated });
  } catch (err) {
    console.error('[logo-position]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* GET /api/creatives/logo-refresh-info?job_id=…
   Liefert alles fuer Banner + Auswahl-Modal des Logo-Tauschs:
   - logo_url / logo_uploaded_at des Kunden
   - offene_review (Transparenz-Hinweis)
   - je aktivem Creative: veraltet? (aelter als Logo), tauschbar? + Grund */
router.get('/logo-refresh-info', async (req, res) => {
  const { job_id } = req.query;
  if (!job_id) return res.status(400).json({ error: 'job_id ist Pflicht.' });

  const { data: job } = await supabase.from('talentone_jobs').select('id, kunde_id').eq('id', job_id).single();
  if (!job) return res.status(404).json({ error: 'Job nicht gefunden.' });
  const { data: kunde } = await supabase.from('talentone_kunden')
    .select('id, logo_url, logo_uploaded_at').eq('id', job.kunde_id).single();

  const { data: creatives = [] } = await supabase.from('talentone_creatives')
    .select('id, format, typ, created_at, bild_url, bild_ohne_logo_url, logo_position')
    .eq('job_id', job_id).eq('archiviert', false)
    .order('created_at', { ascending: false });

  const logoTs = kunde?.logo_uploaded_at ? new Date(kunde.logo_uploaded_at).getTime() : null;

  const rows = creatives.map(c => {
    let swappable = false, reason = null;
    if (c.typ === 'video') { reason = 'Video — Logo-Tausch nicht möglich.'; }
    else if (c.typ === 'overlay') { swappable = true; }
    else if (c.bild_ohne_logo_url) { swappable = true; }
    else { reason = 'Kein Basisbild gespeichert — nur Neu-Generierung möglich.'; }
    // "veraltet" = vor dem letzten Logo-Upload entstanden
    const veraltet = logoTs != null && new Date(c.created_at).getTime() < logoTs;
    return {
      id: c.id, format: c.format, typ: c.typ, created_at: c.created_at,
      bild_url: c.bild_url, hat_position: !!c.logo_position,
      veraltet, swappable, reason,
    };
  });

  // Offene Review-Runde? (Kunde hat Entwuerfe zur Freigabe -> Transparenz-Hinweis)
  const { data: latestReview } = await supabase.from('talentone_reviews')
    .select('status, runde').eq('job_id', job_id)
    .order('runde', { ascending: false }).limit(1).maybeSingle();

  res.json({
    logo_url: kunde?.logo_url || null,
    logo_uploaded_at: kunde?.logo_uploaded_at || null,
    hat_logo: !!kunde?.logo_url,
    offene_review: latestReview?.status === 'offen',
    review_runde: latestReview?.runde || null,
    creatives: rows,
  });
});

/* POST /api/creatives/logo-refresh  body: { job_id, creative_ids: [] }
   Rendert die gewaehlten Creatives mit dem AKTUELLEN Logo neu (in-place),
   ohne die KI-Bilder neu zu generieren. Nicht-tauschbare (Video / kein
   Basisbild) werden mit Grund uebersprungen, nicht abgebrochen. */
router.post('/logo-refresh', async (req, res) => {
  const { job_id, creative_ids } = req.body || {};
  if (!job_id) return res.status(400).json({ error: 'job_id ist Pflicht.' });
  if (!Array.isArray(creative_ids) || creative_ids.length === 0) {
    return res.status(400).json({ error: 'creative_ids (nicht leer) ist Pflicht.' });
  }

  const { data: job } = await supabase.from('talentone_jobs').select('id, kunde_id').eq('id', job_id).single();
  if (!job) return res.status(404).json({ error: 'Job nicht gefunden.' });
  const { data: kunde } = await supabase.from('talentone_kunden')
    .select('id, logo_url, logo_transparent_url').eq('id', job.kunde_id).single();
  if (!kunde?.logo_url) return res.status(400).json({ error: 'Kunde hat kein Logo hinterlegt.' });

  const { data: creatives = [] } = await supabase.from('talentone_creatives')
    .select('*').eq('job_id', job_id).eq('archiviert', false).in('id', creative_ids);

  // Transparentes Logo einmal aufloesen — gilt fuer alle Bild-Creatives.
  let transparentLogo = null;
  try { transparentLogo = await resolveTransparentLogo(kunde); }
  catch (err) { return res.status(500).json({ error: `Logo konnte nicht aufbereitet werden: ${err.message}` }); }

  const ergebnisse = [];
  for (const c of creatives) {
    try {
      if (c.typ === 'video') { ergebnisse.push({ id: c.id, ok: false, reason: 'Video — übersprungen.' }); continue; }
      if (c.typ === 'overlay') {
        const updated = await relogoOverlayCreative(c, job, kunde);
        ergebnisse.push({ id: c.id, ok: true, bild_url: updated.bild_url }); continue;
      }
      if (!c.bild_ohne_logo_url) {
        ergebnisse.push({ id: c.id, ok: false, reason: 'Kein Basisbild — nur Neu-Generierung möglich.' }); continue;
      }
      const updated = await relogoBildCreative(c, transparentLogo);
      ergebnisse.push({ id: c.id, ok: true, bild_url: updated.bild_url });
    } catch (err) {
      console.error(`[logo-refresh] Creative ${c.id}:`, err.message);
      ergebnisse.push({ id: c.id, ok: false, reason: err.message });
    }
  }

  const erfolge = ergebnisse.filter(r => r.ok).length;
  console.log(`[logo-refresh] job ${job_id.slice(0,8)}: ${erfolge}/${ergebnisse.length} Creatives neu belogo-t.`);
  res.json({ aktualisiert: erfolge, gesamt: ergebnisse.length, ergebnisse });
});

/* POST /api/creatives/:id/edit-preview  body: { wunsch }
   Gezielte Änderung: erhält das bestehende Creative und ändert nur den Wunsch.
   Erzeugt eine VORSCHAU (Storage-Upload), legt noch keine DB-Row an — das macht
   edit-apply nach dem Vorher/Nachher-Vergleich. Overlay-Creatives werden
   deterministisch neu gerendert (perfektes Text-Ergebnis). */
router.post('/:id/edit-preview', async (req, res) => {
  const wunsch = (req.body?.wunsch || '').trim();
  if (!wunsch) return res.status(400).json({ error: 'Änderungswunsch (wunsch) ist Pflicht.' });
  const logoAufKleidung = req.body?.logo_auf_kleidung === true || willLogoImMotiv(wunsch);
  const logoModus = req.body?.logo_kleidung_modus === 'icon' ? 'icon' : 'voll';

  const { data: existing, error: e1 } = await supabase
    .from('talentone_creatives').select('*').eq('id', req.params.id).single();
  if (e1 || !existing) return res.status(404).json({ error: 'Creative nicht gefunden.' });
  if (existing.typ === 'video') return res.status(400).json({ error: 'Videos können nicht gezielt geändert werden.' });

  const { data: job } = await supabase.from('talentone_jobs').select('*').eq('id', existing.job_id).single();
  const { data: kunde } = await supabase.from('talentone_kunden').select('*').eq('id', job.kunde_id).single();

  try {
    // Overlay (Modus C): deterministisch neu rendern — pixelperfekter Text.
    if (existing.typ === 'overlay') {
      const aktHook = (existing.prompt || '').match(/Hook:\s*"([^"]*)"/)?.[1] || '';
      const neuHook = await neuerHookAusWunsch({ hook: aktHook, wunsch });
      const fmt = existing.format === 'story' ? '9:16' : '1:1';
      const overlays = await generateOverlays({ job, kunde, spruch: neuHook, benefits: null, formats: [fmt] });
      const match = overlays.find(o => o.format === fmt) || overlays[0];
      if (!match?.bild_url) throw new Error('Overlay-Render lieferte kein Bild.');
      return res.json({ preview: { bild_url: match.bild_url, bild_ohne_logo_url: null, typ: 'overlay' }, deterministisch: true });
    }

    // Bild (ki/foto): gpt-image-2 /images/edits auf dem Basisbild.
    const { bildUrl, bildOhneLogoUrl } = await generateGezielteAenderung({ job, kunde, creative: existing, wunsch, logoAufKleidung, logoModus });
    res.json({ preview: { bild_url: bildUrl, bild_ohne_logo_url: bildOhneLogoUrl, typ: 'bild' }, deterministisch: false });
  } catch (err) {
    console.error('[edit-preview]', err.message);
    res.status(500).json({ error: friendlyOpenAIError(err) });
  }
});

/* POST /api/creatives/edit-discard  body: { urls: [] }
   Loescht verworfene Vorschau-Dateien aus dem Storage (bei "Neu versuchen" /
   Abbrechen), damit nur der final uebernommene Stand liegen bleibt. Best-effort. */
router.post('/edit-discard', async (req, res) => {
  const urls = Array.isArray(req.body?.urls) ? req.body.urls.filter(Boolean) : [];
  await Promise.all(urls.map(u => deleteFromStorage(u).catch(() => {})));
  res.json({ ok: true, geloescht: urls.length });
});

/* POST /api/creatives/:id/edit-apply  body: { wunsch, bild_url, bild_ohne_logo_url }
   Uebernimmt die Vorschau als NEUE Version neben dem Original (parent_id-Link,
   Original bleibt). Erbt Format, typ, stilvorlage_id und Logo-Position. */
router.post('/:id/edit-apply', async (req, res) => {
  const { wunsch, bild_url, bild_ohne_logo_url } = req.body || {};
  if (!bild_url) return res.status(400).json({ error: 'bild_url (Vorschau) ist Pflicht.' });

  const { data: original, error: e1 } = await supabase
    .from('talentone_creatives').select('*').eq('id', req.params.id).single();
  if (e1 || !original) return res.status(404).json({ error: 'Original-Creative nicht gefunden.' });

  const { data: created, error: insErr } = await supabase
    .from('talentone_creatives')
    .insert({
      job_id: original.job_id,
      format: original.format,
      typ: original.typ,
      bild_url,
      bild_ohne_logo_url: bild_ohne_logo_url || null,
      logo_position: original.logo_position || null,
      stilvorlage_id: original.stilvorlage_id || null,
      parent_id: original.id,
      status: 'fertig',
      prompt: `${original.prompt || ''}${original.prompt ? ' · ' : ''}Gezielt geändert: ${(wunsch || '').slice(0, 200)}`,
    })
    .select().single();
  if (insErr) return res.status(500).json({ error: insErr.message });

  console.log(`[edit-apply] job ${original.job_id.slice(0,8)}: gezielte Änderung als neue Version ${created.id.slice(0,8)}.`);
  res.status(201).json({ creative: created });
});

export default router;
