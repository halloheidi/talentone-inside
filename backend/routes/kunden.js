import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { supabase } from '../supabase.js';
import { extractFromUrl, extractFromFile, toKunde, toJob } from '../extractor.js';
import { uploadBuffer, deleteFromBucket, extFromMime, safeFilenameStem } from '../storage.js';
import { sendUploadAnfrage } from '../mail.js';

const router = Router();

const PUBLIC_BASE = process.env.PUBLIC_BASE_URL || 'https://inside.talent-one.de';

function decodeBase64File(fileData) {
  return Buffer.from(fileData, 'base64');
}

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

/* ─────────────────── Logo ─────────────────── */

// POST /api/kunden/:id/logo  body: { fileData: base64, fileName, contentType? }
router.post('/:id/logo', async (req, res) => {
  const { fileData, fileName = 'logo.png', contentType = 'image/png' } = req.body || {};
  if (!fileData) return res.status(400).json({ error: 'fileData fehlt.' });

  const { data: existing } = await supabase
    .from('talentone_kunden')
    .select('id, logo_url')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Kunde nicht gefunden.' });

  try {
    const buffer = decodeBase64File(fileData);
    const ext = extFromMime(contentType, 'png');
    const stem = safeFilenameStem(fileName);
    const path = `${req.params.id}/${Date.now()}-${stem}.${ext}`;
    const publicUrl = await uploadBuffer({ bucket: 'talentone-logos', path, buffer, contentType });

    if (existing.logo_url) await deleteFromBucket('talentone-logos', existing.logo_url);

    const { data: updated, error: uErr } = await supabase
      .from('talentone_kunden')
      .update({ logo_url: publicUrl })
      .eq('id', req.params.id)
      .select()
      .single();
    if (uErr) return res.status(500).json({ error: uErr.message });

    res.status(201).json({ kunde: updated });
  } catch (err) {
    console.error('[logo-upload]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/logo', async (req, res) => {
  const { data: existing } = await supabase
    .from('talentone_kunden').select('logo_url').eq('id', req.params.id).maybeSingle();
  if (existing?.logo_url) await deleteFromBucket('talentone-logos', existing.logo_url);
  await supabase.from('talentone_kunden').update({ logo_url: null }).eq('id', req.params.id);
  res.json({ ok: true });
});

/* ─────────────────── Referenzbilder ─────────────────── */

router.get('/:id/referenzbilder', async (req, res) => {
  const { data, error } = await supabase
    .from('talentone_referenzbilder')
    .select('*')
    .eq('kunde_id', req.params.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ referenzbilder: data });
});

// POST /api/kunden/:id/referenzbilder body: { fileData (base64), fileName, contentType, label? }
router.post('/:id/referenzbilder', async (req, res) => {
  const { fileData, fileName = 'foto.jpg', contentType = 'image/jpeg', label } = req.body || {};
  if (!fileData) return res.status(400).json({ error: 'fileData fehlt.' });

  const { data: kunde } = await supabase
    .from('talentone_kunden').select('id').eq('id', req.params.id).maybeSingle();
  if (!kunde) return res.status(404).json({ error: 'Kunde nicht gefunden.' });

  try {
    const buffer = decodeBase64File(fileData);
    const ext = extFromMime(contentType, 'jpg');
    const stem = safeFilenameStem(fileName);
    const path = `${req.params.id}/${Date.now()}-${stem}.${ext}`;
    const publicUrl = await uploadBuffer({ bucket: 'talentone-referenzbilder', path, buffer, contentType });

    const { data: row, error: insErr } = await supabase
      .from('talentone_referenzbilder')
      .insert({
        kunde_id: req.params.id, bild_url: publicUrl,
        typ: 'foto', label: label || null, uploaded_via: 'mitarbeiter',
      })
      .select().single();
    if (insErr) return res.status(500).json({ error: insErr.message });

    res.status(201).json({ referenzbild: row });
  } catch (err) {
    console.error('[ref-upload]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/referenzbilder/:id', async (req, res) => {
  const { data: existing } = await supabase
    .from('talentone_referenzbilder').select('bild_url').eq('id', req.params.id).maybeSingle();
  if (existing?.bild_url) await deleteFromBucket('talentone-referenzbilder', existing.bild_url);
  const { error } = await supabase.from('talentone_referenzbilder').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

/* ─────────────────── Upload-Anfrage per Mail ─────────────────── */

// POST /api/kunden/:id/anfrage  body: { customText? } — schickt Mail mit Upload-Link
router.post('/:id/anfrage', async (req, res) => {
  const { customText } = req.body || {};
  const { data: kunde, error: kErr } = await supabase
    .from('talentone_kunden').select('*').eq('id', req.params.id).maybeSingle();
  if (kErr || !kunde) return res.status(404).json({ error: 'Kunde nicht gefunden.' });
  if (!kunde.email) return res.status(400).json({ error: 'Kunde hat keine E-Mail-Adresse.' });

  // Upload-Token erzeugen falls noch keiner existiert
  let token = kunde.upload_token;
  if (!token) {
    token = randomUUID();
    const { error: uErr } = await supabase
      .from('talentone_kunden').update({ upload_token: token }).eq('id', kunde.id);
    if (uErr) return res.status(500).json({ error: uErr.message });
  }

  const uploadUrl = `${PUBLIC_BASE}/upload/${token}`;

  try {
    await sendUploadAnfrage({
      to: kunde.email,
      kundenname: kunde.firmenname || 'euer Team',
      ansprechpartner: kunde.ansprechpartner,
      uploadUrl,
      customText,
    });
    res.json({ ok: true, uploadUrl });
  } catch (err) {
    console.error('[anfrage]', err.message);
    res.status(503).json({ error: err.message });
  }
});

export default router;
