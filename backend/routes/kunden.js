import { Router } from 'express';
import { supabase } from '../supabase.js';
import { extractFromUrl, extractFromFile, toKunde, toJob } from '../extractor.js';

const router = Router();

// Quick-Create: legt in einem Schritt Kunde + ersten Job an.
// Modi:
//   manual  → req.body.kunde + req.body.job  (User-Eingaben)
//   url     → req.body.url                   (Puppeteer + Claude)
//   file    → req.body.fileData (base64) + req.body.fileType  (pdf-parse/mammoth + Claude)
router.post('/quick-create', async (req, res) => {
  const { mode } = req.body || {};
  let kundeData = {};
  let jobData = {};

  try {
    if (mode === 'manual') {
      const { kunde = {}, job = {} } = req.body;
      if (!kunde.firmenname?.trim()) return res.status(400).json({ error: 'Firmenname ist Pflicht.' });
      if (!job.stelle?.trim()) return res.status(400).json({ error: 'Stelle ist Pflicht.' });
      kundeData = {
        firmenname: kunde.firmenname.trim(),
        ansprechpartner: kunde.ansprechpartner || null,
        email: kunde.email || null,
        telefon: kunde.telefon || null,
        branche: kunde.branche || null,
        notizen: kunde.notizen || null,
      };
      jobData = {
        stelle: job.stelle.trim(),
        region: job.region || null,
        gehalt: job.gehalt || null,
        eingabe_methode: 'neu',
      };
    } else if (mode === 'url') {
      const { url } = req.body;
      const extracted = await extractFromUrl(url);
      kundeData = toKunde(extracted);
      jobData = toJob(extracted, 'url', url);
      if (!kundeData.firmenname) return res.status(422).json({ error: 'Firmenname konnte nicht ermittelt werden.', extracted });
      if (!jobData.stelle) jobData.stelle = 'Unbenannte Stelle';
    } else if (mode === 'file') {
      const { fileData, fileType } = req.body;
      const extracted = await extractFromFile(fileData, fileType);
      kundeData = toKunde(extracted);
      jobData = toJob(extracted, 'pdf');
      if (!kundeData.firmenname) return res.status(422).json({ error: 'Firmenname konnte nicht ermittelt werden.', extracted });
      if (!jobData.stelle) jobData.stelle = 'Unbenannte Stelle';
    } else {
      return res.status(400).json({ error: 'Unbekannter Modus.' });
    }

    const { data: kunde, error: kErr } = await supabase
      .from('talentone_kunden')
      .insert(kundeData)
      .select()
      .single();
    if (kErr) return res.status(500).json({ error: `Kunde anlegen: ${kErr.message}` });

    const { data: job, error: jErr } = await supabase
      .from('talentone_jobs')
      .insert({ ...jobData, kunde_id: kunde.id })
      .select()
      .single();
    if (jErr) {
      // Kunde wieder löschen, damit kein Halb-Zustand bleibt
      await supabase.from('talentone_kunden').delete().eq('id', kunde.id);
      return res.status(500).json({ error: `Job anlegen: ${jErr.message}` });
    }

    res.status(201).json({ kunde, job });
  } catch (err) {
    console.error('[quick-create]', err.message);
    if (/Claude API 529/.test(err.message)) {
      return res.status(503).json({ error: 'Die KI ist gerade überlastet. Bitte in 1-2 Minuten erneut versuchen — oder Tab "Manuell" nutzen.' });
    }
    if (/Claude API 429/.test(err.message)) {
      return res.status(503).json({ error: 'Rate-Limit erreicht. Bitte kurz warten und erneut versuchen.' });
    }
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('talentone_kunden')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ kunden: data });
});

router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('talentone_kunden')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Kunde nicht gefunden.' });
  res.json({ kunde: data });
});

router.post('/', async (req, res) => {
  const { firmenname, ansprechpartner, email, telefon, logo_url, branche, notizen } = req.body || {};
  if (!firmenname) return res.status(400).json({ error: 'firmenname ist Pflicht.' });
  const { data, error } = await supabase
    .from('talentone_kunden')
    .insert({ firmenname, ansprechpartner, email, telefon, logo_url, branche, notizen })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ kunde: data });
});

router.patch('/:id', async (req, res) => {
  const allowed = ['firmenname', 'ansprechpartner', 'email', 'telefon', 'logo_url', 'branche', 'notizen'];
  const patch = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
  const { data, error } = await supabase
    .from('talentone_kunden')
    .update(patch)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ kunde: data });
});

router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('talentone_kunden').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

export default router;
