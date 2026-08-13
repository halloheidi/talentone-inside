import { Router } from 'express';
import { supabase } from '../supabase.js';
import { generateAdCopy, ensureLinkInText, isValidStyle, STYLES, generateHeadlines } from '../adcopies.js';
import { getPublicBaseUrl } from '../branding.js';

const router = Router();

// Liefert die aktuell gültige Funnel-URL oder null (wenn kein Funnel oder intern aber nicht veröffentlicht)
async function loadFunnelUrl(job_id) {
  const { data: funnel } = await supabase
    .from('talentone_funnels')
    .select('id, veroeffentlicht, extern, extern_url, job_id')
    .eq('job_id', job_id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!funnel) return null;
  if (funnel.extern && funnel.extern_url) return funnel.extern_url;
  if (funnel.veroeffentlicht) {
    // Brand-Domain anhand kunde.agentur
    const { data: job } = await supabase
      .from('talentone_jobs').select('kunde_id').eq('id', funnel.job_id).maybeSingle();
    const { data: kunde } = job ? await supabase
      .from('talentone_kunden').select('agentur').eq('id', job.kunde_id).maybeSingle()
      : { data: null };
    return `${getPublicBaseUrl(kunde?.agentur)}/f/${funnel.id}`;
  }
  return null;
}

/* GET /api/adcopies?job_id=…  */
router.get('/', async (req, res) => {
  let q = supabase.from('talentone_adcopies').select('*');
  if (req.query.job_id) q = q.eq('job_id', req.query.job_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  // Stabile Sortierung: emotional → benefit → kompakt
  const order = Object.fromEntries(STYLES.map((s, i) => [s, i]));
  data.sort((a, b) => (order[a.stil] ?? 99) - (order[b.stil] ?? 99));
  res.json({ adcopies: data });
});

async function loadJobAndKunde(job_id) {
  const { data: job, error: jE } = await supabase
    .from('talentone_jobs').select('*').eq('id', job_id).single();
  if (jE || !job) throw new Error('Job nicht gefunden.');
  const { data: kunde } = await supabase
    .from('talentone_kunden').select('*').eq('id', job.kunde_id).single();
  return { job, kunde };
}

// Konsistenz: bereits gewählte Bild-Sprüche/Hooks aus vorhandenen (nicht
// archivierten) Creatives ziehen, damit Ad-Copy dieselbe Botschaft weiterführt.
// Die Sprüche stecken im prompt-Text der Creative-Zeile (Overlay-Hook bzw.
// „Wortlaut: …"). Best-effort — kein Schema-Change.
async function loadSpruchKontext(job_id) {
  const { data: creatives = [] } = await supabase
    .from('talentone_creatives')
    .select('prompt, created_at, archiviert')
    .eq('job_id', job_id)
    .neq('archiviert', true)
    .order('created_at', { ascending: false })
    .limit(12);
  const hooks = [];
  const seen = new Set();
  const re = /(?:Hook|Wortlaut)[^:"]*:\s*"([^"]{2,90})"/gi;
  for (const c of creatives || []) {
    const p = c?.prompt || '';
    let m;
    while ((m = re.exec(p)) !== null) {
      const h = m[1].trim();
      const key = h.toLowerCase();
      if (h && !seen.has(key)) { seen.add(key); hooks.push(h); }
    }
    if (hooks.length >= 3) break;
  }
  return hooks.length ? hooks.slice(0, 3).map(h => `- "${h}"`).join('\n') : null;
}

async function generateAndStore({ job, kunde, style, funnelUrl, spruchKontext }) {
  // Bestehende für diesen Style+Job löschen (Replace-Semantik)
  await supabase.from('talentone_adcopies')
    .delete().eq('job_id', job.id).eq('stil', style);
  const out = await generateAdCopy({ job, kunde, style, funnelUrl, spruchKontext });
  const { data, error } = await supabase
    .from('talentone_adcopies')
    .insert({ job_id: job.id, stil: out.stil, text: out.text, ueberschriften: out.ueberschriften || [], bearbeitet: false })
    .select().single();
  if (error) throw new Error(error.message);
  return data;
}

/* POST /api/adcopies/generate
   body: { job_id, styles?: Array<'emotional'|'benefit'|'kompakt'>, force?: boolean }
   Generiert die übergebenen Styles parallel. Skipt manuell bearbeitete (bearbeitet=true)
   wenn force !== true. Default: alle 3 Styles. */
router.post('/generate', async (req, res) => {
  const { job_id, styles, force } = req.body || {};
  if (!job_id) return res.status(400).json({ error: 'job_id ist Pflicht.' });
  const wanted = Array.isArray(styles) && styles.length
    ? styles.filter(isValidStyle)
    : STYLES.slice();
  if (!wanted.length) return res.status(400).json({ error: 'Keine gültigen Stile angegeben.' });

  try {
    const { job, kunde } = await loadJobAndKunde(job_id);
    const funnelUrl = await loadFunnelUrl(job_id);
    const spruchKontext = await loadSpruchKontext(job_id);

    // Bestehende laden (für Skip-Logik)
    const { data: existing = [] } = await supabase
      .from('talentone_adcopies').select('*').eq('job_id', job_id);

    const skipped = [];
    const toGenerate = wanted.filter(s => {
      const cur = existing.find(e => e.stil === s);
      if (cur?.bearbeitet && !force) {
        skipped.push({ stil: s, reason: 'manuell bearbeitet — force erforderlich' });
        return false;
      }
      return true;
    });

    const results = await Promise.allSettled(
      toGenerate.map(s => generateAndStore({ job, kunde, style: s, funnelUrl, spruchKontext }))
    );
    const generated = results.filter(r => r.status === 'fulfilled').map(r => r.value);
    const errors = results
      .map((r, i) => r.status === 'rejected' ? { stil: toGenerate[i], error: r.reason.message } : null)
      .filter(Boolean);

    res.status(201).json({ adcopies: generated, skipped, errors });
  } catch (err) {
    console.error('[adcopies/generate]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* POST /api/adcopies/:id/regenerate — generiert nur diesen einen Eintrag neu (Style bleibt) */
router.post('/:id/regenerate', async (req, res) => {
  try {
    const { data: existing, error: e1 } = await supabase
      .from('talentone_adcopies').select('*').eq('id', req.params.id).single();
    if (e1 || !existing) return res.status(404).json({ error: 'Ad-Copy nicht gefunden.' });
    const { job, kunde } = await loadJobAndKunde(existing.job_id);
    const funnelUrl = await loadFunnelUrl(existing.job_id);
    const spruchKontext = await loadSpruchKontext(existing.job_id);
    const out = await generateAdCopy({ job, kunde, style: existing.stil, funnelUrl, spruchKontext });
    const { data, error } = await supabase
      .from('talentone_adcopies')
      .update({ text: out.text, ueberschriften: out.ueberschriften || [], bearbeitet: false })
      .eq('id', existing.id)
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(200).json({ adcopy: data });
  } catch (err) {
    console.error('[adcopies/regenerate]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* PATCH /api/adcopies/:id  body: { text } — manuelle Edits, setzt bearbeitet=true */
router.patch('/:id', async (req, res) => {
  const { text } = req.body || {};
  if (typeof text !== 'string') return res.status(400).json({ error: 'text ist Pflicht.' });
  const { data, error } = await supabase
    .from('talentone_adcopies')
    .update({ text, bearbeitet: true })
    .eq('id', req.params.id)
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ adcopy: data });
});

router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('talentone_adcopies').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

/* POST /api/adcopies/update-links body: { job_id } — Funnel-URL in alle Texte injizieren/erneuern.
   - Ersetzt [Funnel-Link wird ergänzt] durch die aktuelle URL
   - Ersetzt vorhandene andere URL durch die neue
   - Hängt CTA-Zeile an wenn weder Platzhalter noch URL vorhanden
   Returns: { updated: <n>, skipped: <n>, funnel_url } */
router.post('/update-links', async (req, res) => {
  const { job_id } = req.body || {};
  if (!job_id) return res.status(400).json({ error: 'job_id ist Pflicht.' });

  try {
    const funnelUrl = await loadFunnelUrl(job_id);
    if (!funnelUrl) return res.status(400).json({ error: 'Kein Funnel-Link verfügbar — bitte erst Funnel anlegen oder externe URL eintragen.' });

    const { data: list = [] } = await supabase
      .from('talentone_adcopies').select('*').eq('job_id', job_id);

    let updated = 0, skipped = 0;
    for (const a of list) {
      const nextText = ensureLinkInText(a.text || '', funnelUrl);
      if (nextText === a.text) { skipped++; continue; }
      const { error } = await supabase
        .from('talentone_adcopies').update({ text: nextText }).eq('id', a.id);
      if (!error) updated++;
    }
    res.json({ updated, skipped, funnel_url: funnelUrl });
  } catch (err) {
    console.error('[update-links]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ───────────────────── Headlines / Überschriften ─────────────────────
   Werden in talentone_jobs.formdata_komplett.headlines persistiert
   (kein Schema-Change nötig). */

/* GET /api/adcopies/headlines?job_id=… */
router.get('/headlines', async (req, res) => {
  const { job_id } = req.query || {};
  if (!job_id) return res.status(400).json({ error: 'job_id ist Pflicht.' });
  const { data: job, error } = await supabase
    .from('talentone_jobs').select('formdata_komplett').eq('id', job_id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  const headlines = Array.isArray(job?.formdata_komplett?.headlines)
    ? job.formdata_komplett.headlines
    : [];
  res.json({ headlines });
});

/* POST /api/adcopies/headlines/generate  body: { job_id }
   Generiert 5 frische Headlines via Claude + persistiert sie. */
router.post('/headlines/generate', async (req, res) => {
  const { job_id } = req.body || {};
  if (!job_id) return res.status(400).json({ error: 'job_id ist Pflicht.' });
  try {
    const { data: job, error: jE } = await supabase
      .from('talentone_jobs').select('*').eq('id', job_id).single();
    if (jE || !job) return res.status(404).json({ error: 'Job nicht gefunden.' });
    const { data: kunde } = await supabase
      .from('talentone_kunden').select('*').eq('id', job.kunde_id).single();

    const headlines = await generateHeadlines({ job, kunde });

    // In formdata_komplett.headlines speichern
    const merged = { ...(job.formdata_komplett || {}), headlines };
    await supabase.from('talentone_jobs')
      .update({ formdata_komplett: merged })
      .eq('id', job_id);

    res.json({ headlines });
  } catch (err) {
    console.error('[adcopies/headlines]', err.message);
    res.status(503).json({ error: err.message });
  }
});

/* PATCH /api/adcopies/headlines  body: { job_id, headlines: [...] }
   Speichert manuell editierte Headlines. */
router.patch('/headlines', async (req, res) => {
  const { job_id, headlines } = req.body || {};
  if (!job_id) return res.status(400).json({ error: 'job_id ist Pflicht.' });
  if (!Array.isArray(headlines)) return res.status(400).json({ error: 'headlines muss ein Array sein.' });
  const clean = headlines.map(h => String(h || '').slice(0, 80)).slice(0, 10);
  try {
    const { data: job } = await supabase
      .from('talentone_jobs').select('formdata_komplett').eq('id', job_id).maybeSingle();
    const merged = { ...(job?.formdata_komplett || {}), headlines: clean };
    const { error } = await supabase.from('talentone_jobs')
      .update({ formdata_komplett: merged })
      .eq('id', job_id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ headlines: clean });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
