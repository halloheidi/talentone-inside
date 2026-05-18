// Public Routen — KEIN Login nötig, aber abgesichert per Token im Pfad.
// Wird in server.js OHNE requireAuth gemountet.

import { Router } from 'express';
import { supabase } from '../supabase.js';
import { uploadBuffer, deleteFromBucket, extFromMime, safeFilenameStem } from '../storage.js';
import { extractFromUrl, extractFromFile } from '../extractor.js';
import { extractColorsFromUrl, extractColorsFromImageBuffer } from '../colors.js';
import { sendFormularEingang } from '../mail.js';

const router = Router();

const MITARBEITER_MAIL = process.env.MITARBEITER_MAIL || 'info@nowagwirth.de';
const PUBLIC_BASE = process.env.PUBLIC_BASE_URL || 'https://inside.talent-one.de';

async function loadKundeByToken(token) {
  const { data } = await supabase
    .from('talentone_kunden').select('*').eq('formular_token', token).maybeSingle();
  return data;
}

// GET /api/public/upload/:token — minimale Kunden-Info für die öffentliche Upload-Seite
router.get('/upload/:token', async (req, res) => {
  const { data: kunde } = await supabase
    .from('talentone_kunden')
    .select('id, firmenname, ansprechpartner, logo_url')
    .eq('upload_token', req.params.token)
    .maybeSingle();
  if (!kunde) return res.status(404).json({ error: 'Link ungültig oder abgelaufen.' });
  res.json({
    kunde: {
      firmenname: kunde.firmenname,
      ansprechpartner: kunde.ansprechpartner,
      hat_logo: !!kunde.logo_url,
    },
  });
});

// POST /api/public/upload/:token  body: { typ: 'logo' | 'foto', fileData (base64), fileName, contentType, beschreibung? }
router.post('/upload/:token', async (req, res) => {
  const { typ, fileData, fileName = 'datei.jpg', contentType = 'image/jpeg', beschreibung } = req.body || {};
  if (!['logo', 'foto'].includes(typ)) return res.status(400).json({ error: 'typ muss "logo" oder "foto" sein.' });
  if (!fileData) return res.status(400).json({ error: 'fileData fehlt.' });

  const { data: kunde } = await supabase
    .from('talentone_kunden')
    .select('id, firmenname, logo_url')
    .eq('upload_token', req.params.token)
    .maybeSingle();
  if (!kunde) return res.status(404).json({ error: 'Link ungültig oder abgelaufen.' });

  try {
    const buffer = Buffer.from(fileData, 'base64');
    const ext = extFromMime(contentType, typ === 'logo' ? 'png' : 'jpg');
    const stem = safeFilenameStem(fileName);
    const path = `${kunde.id}/${Date.now()}-${stem}.${ext}`;

    if (typ === 'logo') {
      const publicUrl = await uploadBuffer({
        bucket: 'talentone-logos', path, buffer, contentType,
      });
      // Altes Logo aufräumen
      if (kunde.logo_url) {
        const { deleteFromBucket } = await import('../storage.js');
        await deleteFromBucket('talentone-logos', kunde.logo_url);
      }
      await supabase.from('talentone_kunden').update({ logo_url: publicUrl }).eq('id', kunde.id);
      // zusätzlich in talentone_referenzbilder als typ=logo loggen, damit der Mitarbeiter den Verlauf sieht
      await supabase.from('talentone_referenzbilder').insert({
        kunde_id: kunde.id, bild_url: publicUrl, typ: 'logo', uploaded_via: 'kunde',
      });
      return res.status(201).json({ ok: true, typ: 'logo', bild_url: publicUrl });
    }

    // typ === 'foto'
    const publicUrl = await uploadBuffer({
      bucket: 'talentone-referenzbilder', path, buffer, contentType,
    });
    const { data: row, error: insErr } = await supabase
      .from('talentone_referenzbilder')
      .insert({
        kunde_id: kunde.id, bild_url: publicUrl, typ: 'foto',
        beschreibung: beschreibung || null,
        uploaded_via: 'kunde',
      })
      .select().single();
    if (insErr) return res.status(500).json({ error: insErr.message });
    res.status(201).json({ ok: true, typ: 'foto', referenzbild: row });
  } catch (err) {
    console.error('[public-upload]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ───────────────── Formular-Token (Kunde füllt selbst aus) ───────────────── */

// GET /api/public/formular/:token
router.get('/formular/:token', async (req, res) => {
  const kunde = await loadKundeByToken(req.params.token);
  if (!kunde) return res.status(404).json({ error: 'Link ungültig oder abgelaufen.' });
  if (kunde.status === 'aktiv') {
    return res.status(410).json({ error: 'Dieses Formular wurde bereits ausgefüllt.' });
  }
  res.json({
    kunde: {
      firmenname: kunde.firmenname,
      ansprechpartner: kunde.ansprechpartner,
      email: kunde.email,
    },
  });
});

// POST /api/public/formular/:token/extract  body: { mode: 'url'|'file', url?, fileType?, fileData? }
// Liefert die KI-extrahierten Felder (Vorausfüllung), kein DB-Update.
router.post('/formular/:token/extract', async (req, res) => {
  const kunde = await loadKundeByToken(req.params.token);
  if (!kunde) return res.status(404).json({ error: 'Link ungültig.' });
  if (kunde.status === 'aktiv') return res.status(410).json({ error: 'Bereits ausgefüllt.' });

  try {
    const { mode } = req.body || {};
    let extracted;
    if (mode === 'url') {
      if (!req.body.url) return res.status(400).json({ error: 'URL fehlt.' });
      extracted = await extractFromUrl(req.body.url);
    } else if (mode === 'file') {
      if (!req.body.fileData || !req.body.fileType) return res.status(400).json({ error: 'fileData / fileType fehlt.' });
      extracted = await extractFromFile(req.body.fileData, req.body.fileType);
    } else {
      return res.status(400).json({ error: 'Unbekannter Modus.' });
    }
    res.json({ extracted });
  } catch (err) {
    console.error('[formular/extract]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/public/formular/:token/logo  body: { fileData (b64), fileName, contentType }
router.post('/formular/:token/logo', async (req, res) => {
  const kunde = await loadKundeByToken(req.params.token);
  if (!kunde) return res.status(404).json({ error: 'Link ungültig.' });
  if (kunde.status === 'aktiv') return res.status(410).json({ error: 'Bereits ausgefüllt.' });

  const { fileData, fileName = 'logo.png', contentType = 'image/png' } = req.body || {};
  if (!fileData) return res.status(400).json({ error: 'fileData fehlt.' });

  try {
    const buffer = Buffer.from(fileData, 'base64');
    const ext = extFromMime(contentType, 'png');
    const stem = safeFilenameStem(fileName);
    const path = `${kunde.id}/${Date.now()}-${stem}.${ext}`;
    const publicUrl = await uploadBuffer({ bucket: 'talentone-logos', path, buffer, contentType });
    if (kunde.logo_url) await deleteFromBucket('talentone-logos', kunde.logo_url);
    await supabase.from('talentone_kunden').update({ logo_url: publicUrl }).eq('id', kunde.id);
    res.status(201).json({ logo_url: publicUrl });
  } catch (err) {
    console.error('[formular/logo]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/public/formular/:token/foto  body: { fileData, fileName, contentType, beschreibung? }
router.post('/formular/:token/foto', async (req, res) => {
  const kunde = await loadKundeByToken(req.params.token);
  if (!kunde) return res.status(404).json({ error: 'Link ungültig.' });
  if (kunde.status === 'aktiv') return res.status(410).json({ error: 'Bereits ausgefüllt.' });

  const { fileData, fileName = 'foto.jpg', contentType = 'image/jpeg', beschreibung } = req.body || {};
  if (!fileData) return res.status(400).json({ error: 'fileData fehlt.' });

  try {
    const buffer = Buffer.from(fileData, 'base64');
    const ext = extFromMime(contentType, 'jpg');
    const stem = safeFilenameStem(fileName);
    const path = `${kunde.id}/${Date.now()}-${stem}.${ext}`;
    const publicUrl = await uploadBuffer({ bucket: 'talentone-referenzbilder', path, buffer, contentType });
    const { data: row, error: insErr } = await supabase
      .from('talentone_referenzbilder').insert({
        kunde_id: kunde.id, bild_url: publicUrl, typ: 'foto',
        beschreibung: beschreibung || null, uploaded_via: 'kunde',
      }).select().single();
    if (insErr) return res.status(500).json({ error: insErr.message });
    res.status(201).json({ referenzbild: row });
  } catch (err) {
    console.error('[formular/foto]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/public/formular/:token/submit  body: { kunde: {...}, job: {...}, formdata: {...} }
// Speichert alle Formular-Daten, legt Job an, setzt status='aktiv', triggert Farb-Extraktion + Mitarbeiter-Mail
router.post('/formular/:token/submit', async (req, res) => {
  const kunde = await loadKundeByToken(req.params.token);
  if (!kunde) return res.status(404).json({ error: 'Link ungültig.' });
  if (kunde.status === 'aktiv') return res.status(410).json({ error: 'Bereits ausgefüllt.' });

  const { kunde: kundePatch = {}, job: jobPatch = {}, formdata = {} } = req.body || {};
  if (!kundePatch.firmenname?.trim()) return res.status(400).json({ error: 'Firmenname ist Pflicht.' });
  if (!jobPatch.stelle?.trim()) return res.status(400).json({ error: 'Stelle ist Pflicht.' });

  try {
    // Kunde aktualisieren
    const kundeUpdate = {
      firmenname: kundePatch.firmenname.trim(),
      ansprechpartner: kundePatch.ansprechpartner?.trim() || null,
      telefon: kundePatch.telefon?.trim() || null,
      website_url: kundePatch.website_url?.trim() || null,
      branche: kundePatch.branche || null,
      status: 'aktiv',
    };
    const { data: updated, error: uErr } = await supabase
      .from('talentone_kunden').update(kundeUpdate).eq('id', kunde.id).select().single();
    if (uErr) return res.status(500).json({ error: `Kunde-Update: ${uErr.message}` });

    // Job anlegen
    const jobRow = {
      kunde_id: kunde.id,
      stelle: jobPatch.stelle.trim(),
      region: jobPatch.region?.trim() || null,
      gehalt: jobPatch.gehalt?.trim() || null,
      benefits: Array.isArray(jobPatch.benefits) && jobPatch.benefits.length ? jobPatch.benefits : null,
      besonderheiten: jobPatch.besonderheiten?.trim() || null,
      reisebereitschaft: !!jobPatch.reisebereitschaft,
      quereinsteiger: !!jobPatch.quereinsteiger,
      eingabe_methode: 'formular',
      formdata_komplett: formdata,
    };
    const { data: job, error: jErr } = await supabase
      .from('talentone_jobs').insert(jobRow).select().single();
    if (jErr) return res.status(500).json({ error: `Job anlegen: ${jErr.message}` });

    // Antwort sofort raus
    res.status(201).json({ ok: true });

    // Hintergrund: Farben + Mitarbeiter-Mail
    (async () => {
      // Farben aus Logo bevorzugt, sonst Website
      let farben = null;
      if (updated.logo_url) {
        try {
          const { fetchAsBuffer } = await import('../storage.js');
          const { buffer } = await fetchAsBuffer(updated.logo_url);
          farben = await extractColorsFromImageBuffer(buffer);
        } catch (err) { console.warn('[formular-bg] Logo-Farben:', err.message); }
      }
      if (!farben && updated.website_url) {
        try { farben = await extractColorsFromUrl(updated.website_url); }
        catch (err) { console.warn('[formular-bg] URL-Farben:', err.message); }
      }
      if (farben) await supabase.from('talentone_kunden').update({ farben }).eq('id', kunde.id);

      // Mitarbeiter benachrichtigen
      try {
        await sendFormularEingang({
          to: MITARBEITER_MAIL,
          kundenname: updated.firmenname,
          kundeUrl: `${PUBLIC_BASE}/kunden/${kunde.id}`,
        });
      } catch (err) { console.warn('[formular-bg] Mitarbeiter-Mail:', err.message); }
    })().catch(err => console.error('[formular-bg] uncaught:', err));
  } catch (err) {
    console.error('[formular/submit]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ───────────────── Funnel (öffentliche Bewerbungsseite) ───────────────── */

// GET /api/public/funnel/:id — komplette Funnel-Daten + Job + Kunde-Stub
// Bei externem Funnel: returnt redirect_to-URL statt Daten.
router.get('/funnel/:id', async (req, res) => {
  const { data: funnel } = await supabase
    .from('talentone_funnels').select('*').eq('id', req.params.id).maybeSingle();
  if (!funnel) return res.status(404).json({ error: 'Funnel nicht gefunden.' });
  if (funnel.extern && funnel.extern_url) {
    return res.json({ redirect_to: funnel.extern_url });
  }
  if (!funnel.veroeffentlicht) return res.status(403).json({ error: 'Funnel ist noch nicht veröffentlicht.' });
  const { data: job } = await supabase
    .from('talentone_jobs').select('id, stelle, region, gehalt, benefits, kunde_id').eq('id', funnel.job_id).maybeSingle();
  const { data: kunde } = job ? await supabase
    .from('talentone_kunden').select('id, firmenname, branche, logo_url, farben').eq('id', job.kunde_id).maybeSingle() : { data: null };
  res.json({ funnel, job, kunde });
});

// POST /api/public/funnel/:id/bewerbung  body: { name, email, telefon, antworten, ko_kriterium }
router.post('/funnel/:id/bewerbung', async (req, res) => {
  const { name, email, telefon, antworten, ko_kriterium } = req.body || {};
  const isKo = !!ko_kriterium;

  // Bei KO: name/email/telefon optional. Sonst: mind. eines pflicht.
  if (!isKo && !email?.trim() && !telefon?.trim()) {
    return res.status(400).json({ error: 'E-Mail oder Telefonnummer ist Pflicht.' });
  }
  const { data: funnel } = await supabase
    .from('talentone_funnels').select('*').eq('id', req.params.id).maybeSingle();
  if (!funnel) return res.status(404).json({ error: 'Funnel nicht gefunden.' });
  if (!funnel.veroeffentlicht) return res.status(403).json({ error: 'Funnel nicht veröffentlicht.' });

  const { data, error } = await supabase
    .from('talentone_bewerbungen')
    .insert({
      funnel_id: funnel.id, job_id: funnel.job_id,
      name: name?.trim() || null,
      email: email?.trim() || null,
      telefon: telefon?.trim() || null,
      antworten: antworten || null,
      ko_kriterium: isKo,
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });

  // CAPI: nur bei NICHT-KO und wenn pixel_id + capi_access_token gesetzt
  if (!isKo && funnel.pixel_id && funnel.capi_access_token) {
    const { sendCapiEvent } = await import('../capi.js');
    const clientIp = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || req.ip;
    const userAgent = req.headers['user-agent'];
    sendCapiEvent({
      pixelId: funnel.pixel_id,
      accessToken: funnel.capi_access_token,
      eventName: funnel.conversion_ziel || 'Lead',
      eventSourceUrl: `${process.env.PUBLIC_BASE_URL || 'https://inside.talent-one.de'}/f/${funnel.id}`,
      userData: { email, phone: telefon, clientIp, userAgent },
    }).catch(err => console.warn('[CAPI] uncaught:', err.message));
  }

  res.status(201).json({ ok: true, bewerbung_id: data.id });
});

export default router;
