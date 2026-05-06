import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { supabase } from '../supabase.js';
import { extractFromUrl, extractFromFile, toKunde, toJob } from '../extractor.js';
import { uploadBuffer, deleteFromBucket, extFromMime, safeFilenameStem } from '../storage.js';
import { sendUploadAnfrage, sendFormularEinladung } from '../mail.js';
import { extractColorsFromUrl, extractColorsFromImageBuffer } from '../colors.js';

const router = Router();

const PUBLIC_BASE = process.env.PUBLIC_BASE_URL || 'https://inside.talent-one.de';

function decodeBase64File(fileData) {
  return Buffer.from(fileData, 'base64');
}

// Quick-Create: legt in einem Schritt Kunde + ersten Job an.
// Optional kann ein Logo (base64) mitgegeben werden — wird nach dem Insert hochgeladen
// und zugleich als Farb-Quelle für talentone_kunden.farben analysiert.
// Modi:
//   manual  → req.body.kunde + req.body.job
//   url     → req.body.url                  (Puppeteer + Claude + Farb-Scrape)
//   file    → req.body.fileData (base64) + req.body.fileType
//   logo (alle): req.body.logo = { fileData, fileName?, contentType? }
router.post('/quick-create', async (req, res) => {
  const { mode, logo } = req.body || {};
  let kundeData = {};
  let jobData = {};
  let urlForColors = null;

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
      urlForColors = url;
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

    // Antwort sofort raus — Logo + Farb-Extraktion sind best-effort und blockieren nicht.
    res.status(201).json({ kunde, job });

    // Hintergrund: Logo hochladen + Farben extrahieren (Logo-Farben haben Priorität, sonst URL)
    (async () => {
      let logoUrl = null;
      let logoBuffer = null;

      if (logo?.fileData) {
        try {
          logoBuffer = Buffer.from(logo.fileData, 'base64');
          const ext = extFromMime(logo.contentType || 'image/png', 'png');
          const stem = safeFilenameStem(logo.fileName || 'logo');
          const path = `${kunde.id}/${Date.now()}-${stem}.${ext}`;
          logoUrl = await uploadBuffer({
            bucket: 'talentone-logos', path, buffer: logoBuffer,
            contentType: logo.contentType || 'image/png',
          });
          await supabase.from('talentone_kunden').update({ logo_url: logoUrl }).eq('id', kunde.id);
          console.log(`[quick-create-bg] Logo gesetzt für ${kunde.id.slice(0, 8)}`);
        } catch (err) {
          console.warn('[quick-create-bg] Logo-Upload fehlgeschlagen:', err.message);
        }
      }

      // Farben — Logo bevorzugt, sonst URL
      let farben = null;
      if (logoBuffer) {
        try { farben = await extractColorsFromImageBuffer(logoBuffer); }
        catch (err) { console.warn('[quick-create-bg] Logo-Farben:', err.message); }
      }
      if (!farben && urlForColors) {
        try { farben = await extractColorsFromUrl(urlForColors); }
        catch (err) { console.warn('[quick-create-bg] URL-Farben:', err.message); }
      }
      if (farben) {
        await supabase.from('talentone_kunden').update({ farben }).eq('id', kunde.id);
        console.log(`[quick-create-bg] Farben für ${kunde.id.slice(0, 8)}:`, farben);
      }
    })().catch(err => console.error('[quick-create-bg] uncaught:', err));

    return;
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
  const allowed = ['firmenname', 'ansprechpartner', 'email', 'telefon', 'logo_url', 'branche', 'notizen', 'farben', 'website_url'];
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

/* ─────────────────── Farb-Vorschau (Preview, speichert NICHT) ─────────────────── */

// POST /api/kunden/:id/farben/from-url  body: { url? }
// Wenn url leer → nutzt kunde.website_url. Liefert nur Vorschau, kein DB-Update.
router.post('/:id/farben/from-url', async (req, res) => {
  const { url: bodyUrl } = req.body || {};
  const { data: kunde } = await supabase
    .from('talentone_kunden').select('website_url').eq('id', req.params.id).maybeSingle();
  if (!kunde) return res.status(404).json({ error: 'Kunde nicht gefunden.' });
  const url = (bodyUrl || kunde.website_url || '').trim();
  if (!url) return res.status(400).json({ error: 'Keine URL angegeben (Body oder website_url).' });

  try {
    const farben = await extractColorsFromUrl(url);
    res.json({ farben, url });
  } catch (err) {
    console.error('[farben/from-url]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/kunden/:id/farben/from-logo  → extrahiert aus aktuell gespeichertem Logo
router.post('/:id/farben/from-logo', async (req, res) => {
  const { data: kunde } = await supabase
    .from('talentone_kunden').select('logo_url').eq('id', req.params.id).maybeSingle();
  if (!kunde) return res.status(404).json({ error: 'Kunde nicht gefunden.' });
  if (!kunde.logo_url) return res.status(400).json({ error: 'Kein Logo hinterlegt.' });

  try {
    const { fetchAsBuffer } = await import('../storage.js');
    const { buffer } = await fetchAsBuffer(kunde.logo_url);
    const farben = await extractColorsFromImageBuffer(buffer);
    res.json({ farben });
  } catch (err) {
    console.error('[farben/from-logo]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────── Logo ─────────────────── */

// POST /api/kunden/:id/logo  body: { fileData: base64, fileName, contentType?, autoFarben? }
// Standardmässig werden Farben aus dem Logo extrahiert und nur gesetzt, wenn der
// Kunde noch keine eigenen Farben hat. autoFarben=force überschreibt vorhandene.
router.post('/:id/logo', async (req, res) => {
  const { fileData, fileName = 'logo.png', contentType = 'image/png', autoFarben = 'auto' } = req.body || {};
  if (!fileData) return res.status(400).json({ error: 'fileData fehlt.' });

  const { data: existing } = await supabase
    .from('talentone_kunden')
    .select('id, logo_url, farben')
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

    // Farben aus Logo extrahieren — nur setzen wenn leer (oder force)
    let farbenUpdate = null;
    if (autoFarben !== 'off' && (autoFarben === 'force' || !existing.farben)) {
      try {
        farbenUpdate = await extractColorsFromImageBuffer(buffer);
      } catch (err) {
        console.warn('[logo-upload] Farb-Extraktion:', err.message);
      }
    }

    const update = { logo_url: publicUrl };
    if (farbenUpdate) update.farben = farbenUpdate;

    const { data: updated, error: uErr } = await supabase
      .from('talentone_kunden')
      .update(update)
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

// POST /api/kunden/:id/referenzbilder body: { fileData (base64), fileName, contentType, beschreibung? }
router.post('/:id/referenzbilder', async (req, res) => {
  const { fileData, fileName = 'foto.jpg', contentType = 'image/jpeg', beschreibung, label } = req.body || {};
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
        typ: 'foto', label: label || null,
        beschreibung: beschreibung || null,
        uploaded_via: 'mitarbeiter',
      })
      .select().single();
    if (insErr) return res.status(500).json({ error: insErr.message });

    res.status(201).json({ referenzbild: row });
  } catch (err) {
    console.error('[ref-upload]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/kunden/referenzbilder/:id  body: { beschreibung }
router.patch('/referenzbilder/:id', async (req, res) => {
  const { beschreibung } = req.body || {};
  const { data, error } = await supabase
    .from('talentone_referenzbilder')
    .update({ beschreibung: beschreibung || null })
    .eq('id', req.params.id)
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ referenzbild: data });
});

router.delete('/referenzbilder/:id', async (req, res) => {
  const { data: existing } = await supabase
    .from('talentone_referenzbilder').select('bild_url').eq('id', req.params.id).maybeSingle();
  if (existing?.bild_url) await deleteFromBucket('talentone-referenzbilder', existing.bild_url);
  const { error } = await supabase.from('talentone_referenzbilder').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

/* ─────────────────── Formular-Anlegen (Kunde füllt selbst aus) ─────────────────── */

// POST /api/kunden/formular-anlegen  body: { email, firmenname?, ansprechpartner?, customText? }
router.post('/formular-anlegen', async (req, res) => {
  const { email, firmenname, ansprechpartner, customText } = req.body || {};
  if (!email?.trim()) return res.status(400).json({ error: 'E-Mail ist Pflicht.' });

  const token = randomUUID();
  const { data: kunde, error: kErr } = await supabase
    .from('talentone_kunden')
    .insert({
      email: email.trim(),
      firmenname: firmenname?.trim() || null,
      ansprechpartner: ansprechpartner?.trim() || null,
      status: 'wartend',
      formular_token: token,
    })
    .select().single();
  if (kErr) return res.status(500).json({ error: `Kunde anlegen: ${kErr.message}` });

  const formularUrl = `${PUBLIC_BASE}/formular/${token}`;
  try {
    await sendFormularEinladung({
      to: kunde.email, ansprechpartner: kunde.ansprechpartner,
      formularUrl, customText,
    });
  } catch (err) {
    console.error('[formular-anlegen] Mail:', err.message);
    // Kunde wieder löschen, weil Formular ohne Mail wertlos ist
    await supabase.from('talentone_kunden').delete().eq('id', kunde.id);
    return res.status(503).json({ error: `Mail-Versand fehlgeschlagen: ${err.message}` });
  }

  res.status(201).json({ kunde, formularUrl });
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
