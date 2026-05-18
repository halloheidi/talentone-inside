import { Router } from 'express';
import { supabase } from '../supabase.js';
import { generateAdCopy, ensureLinkInText, isValidStyle, STYLES } from '../adcopies.js';

const router = Router();

const PUBLIC_BASE = process.env.PUBLIC_BASE_URL || 'https://inside.talent-one.de';

// Liefert die aktuell gültige Funnel-URL oder null (wenn kein Funnel oder intern aber nicht veröffentlicht)
async function loadFunnelUrl(job_id) {
  const { data: funnel } = await supabase
    .from('talentone_funnels')
    .select('id, veroeffentlicht, extern, extern_url')
    .eq('job_id', job_id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!funnel) return null;
  if (funnel.extern && funnel.extern_url) return funnel.extern_url;
  if (funnel.veroeffentlicht) return `${PUBLIC_BASE}/f/${funnel.id}`;
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

async function generateAndStore({ job, kunde, style, funnelUrl }) {
  // Bestehende für diesen Style+Job löschen (Replace-Semantik)
  await supabase.from('talentone_adcopies')
    .delete().eq('job_id', job.id).eq('stil', style);
  const out = await generateAdCopy({ job, kunde, style, funnelUrl });
  const { data, error } = await supabase
    .from('talentone_adcopies')
    .insert({ job_id: job.id, stil: out.stil, text: out.text, bearbeitet: false })
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
      toGenerate.map(s => generateAndStore({ job, kunde, style: s, funnelUrl }))
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
    const out = await generateAdCopy({ job, kunde, style: existing.stil, funnelUrl });
    const { data, error } = await supabase
      .from('talentone_adcopies')
      .update({ text: out.text, bearbeitet: false })
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

export default router;
