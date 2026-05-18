// Public Routen — KEIN Login nötig, aber abgesichert per Token im Pfad.
// Wird in server.js OHNE requireAuth gemountet.

import { Router } from 'express';
import { supabase } from '../supabase.js';
import { uploadBuffer, deleteFromBucket, extFromMime, safeFilenameStem } from '../storage.js';
import { extractFromUrl, extractFromFile } from '../extractor.js';
import { extractColorsFromUrl, extractColorsFromImageBuffer } from '../colors.js';
import { sendFormularEingang } from '../mail.js';

const router = Router();

import { getPublicBaseUrl } from '../branding.js';

const MITARBEITER_MAIL = process.env.MITARBEITER_MAIL || 'info@nowagwirth.de';

async function loadKundeByToken(token) {
  const { data } = await supabase
    .from('talentone_kunden').select('*').eq('formular_token', token).maybeSingle();
  return data;
}

// GET /api/public/upload/:token — minimale Kunden-Info für die öffentliche Upload-Seite
router.get('/upload/:token', async (req, res) => {
  const { data: kunde } = await supabase
    .from('talentone_kunden')
    .select('id, firmenname, ansprechpartner, logo_url, agentur')
    .eq('upload_token', req.params.token)
    .maybeSingle();
  if (!kunde) return res.status(404).json({ error: 'Link ungültig oder abgelaufen.' });
  res.json({
    kunde: {
      firmenname: kunde.firmenname,
      ansprechpartner: kunde.ansprechpartner,
      agentur: kunde.agentur || 'talentone',
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
      agentur: kunde.agentur || 'talentone',
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
          kundeUrl: `${getPublicBaseUrl('talentone')}/kunden/${kunde.id}`,
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
    .from('talentone_kunden').select('id, firmenname, branche, logo_url, farben, agentur').eq('id', job.kunde_id).maybeSingle() : { data: null };
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
    // Brand-Domain für eventSourceUrl
    const { data: jobForCapi } = await supabase
      .from('talentone_jobs').select('kunde_id').eq('id', funnel.job_id).maybeSingle();
    const { data: kundeForCapi } = jobForCapi
      ? await supabase.from('talentone_kunden').select('agentur').eq('id', jobForCapi.kunde_id).maybeSingle()
      : { data: null };
    sendCapiEvent({
      pixelId: funnel.pixel_id,
      accessToken: funnel.capi_access_token,
      eventName: funnel.conversion_ziel || 'Lead',
      eventSourceUrl: `${getPublicBaseUrl(kundeForCapi?.agentur)}/f/${funnel.id}`,
      userData: { email, phone: telefon, clientIp, userAgent },
    }).catch(err => console.warn('[CAPI] uncaught:', err.message));
  }

  // Bewerbungs-Mail an Kunden (best-effort, blockt nicht)
  (async () => {
    try {
      const { data: job } = await supabase.from('talentone_jobs').select('*').eq('id', funnel.job_id).maybeSingle();
      const { data: kunde } = job ? await supabase.from('talentone_kunden').select('*').eq('id', job.kunde_id).maybeSingle() : { data: null };
      if (!kunde?.email) return;
      const { sendBewerbungsMail } = await import('../exports.js');
      await sendBewerbungsMail({
        kunde, job,
        bewerbung: { ...data, quelle: 'funnel' },
        sheetUrl: funnel.extern_sheet_url || null,
      });
    } catch (err) { console.warn('[bewerbungs-mail]', err.message); }
  })().catch(err => console.error('[bewerbungs-mail-uncaught]', err.message));

  res.status(201).json({ ok: true, bewerbung_id: data.id });
});

/* ─────── Review-Seite (Token-basiert, ohne Login) ─────── */

// GET /api/public/review/:token — komplette Daten für die Review-Seite
router.get('/review/:token', async (req, res) => {
  const { data: job } = await supabase
    .from('talentone_jobs').select('*').eq('review_token', req.params.token).maybeSingle();
  if (!job) return res.status(404).json({ error: 'Link ungültig oder abgelaufen.' });

  const { data: kunde } = await supabase
    .from('talentone_kunden')
    .select('id, firmenname, branche, logo_url, farben, agentur')
    .eq('id', job.kunde_id).maybeSingle();
  const { data: creatives = [] } = await supabase
    .from('talentone_creatives').select('*').eq('job_id', job.id)
    .order('created_at', { ascending: false });
  const { data: adcopies = [] } = await supabase
    .from('talentone_adcopies').select('*').eq('job_id', job.id);
  const { data: funnel } = await supabase
    .from('talentone_funnels').select('*').eq('job_id', job.id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  const funnelUrl = !funnel?.id ? null
    : (funnel.extern && funnel.extern_url) ? funnel.extern_url
    : funnel.veroeffentlicht ? `${getPublicBaseUrl(kunde?.agentur)}/f/${funnel.id}`
    : null;
  const sheetUrl = funnel?.extern_sheet_url || null;
  const { data: review } = await supabase
    .from('talentone_reviews').select('*').eq('job_id', job.id)
    .order('updated_at', { ascending: false }).limit(1).maybeSingle();

  res.json({
    job: { id: job.id, stelle: job.stelle, region: job.region },
    kunde,
    creatives,
    adcopies,
    funnel_url: funnelUrl,
    sheet_url: sheetUrl,
    review,
  });
});

// POST /api/public/review/:token  body: { status, kommentare }
router.post('/review/:token', async (req, res) => {
  const { status, kommentare } = req.body || {};
  if (!['freigegeben', 'aenderungen'].includes(status)) {
    return res.status(400).json({ error: 'status muss "freigegeben" oder "aenderungen" sein.' });
  }
  const { data: job } = await supabase
    .from('talentone_jobs').select('id, review_token').eq('review_token', req.params.token).maybeSingle();
  if (!job) return res.status(404).json({ error: 'Link ungültig.' });

  // Upsert: existiert schon ein Review für den Job → updaten, sonst insert
  const { data: existing } = await supabase
    .from('talentone_reviews').select('id').eq('job_id', job.id)
    .order('updated_at', { ascending: false }).limit(1).maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from('talentone_reviews')
      .update({ status, kommentare: kommentare || null })
      .eq('id', existing.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, review: data });
  }

  const { data, error } = await supabase
    .from('talentone_reviews')
    .insert({ job_id: job.id, token: req.params.token, status, kommentare: kommentare || null })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ ok: true, review: data });
});

/* ════════════════════ Public Bewerberliste (Token) ════════════════════ */

const FEEDBACK_STATI = ['neu', 'interessant', 'vorstellungsgespraech', 'eingestellt', 'abgesagt'];

async function loadJobByToken(token) {
  const { data } = await supabase
    .from('talentone_jobs')
    .select('id, stelle, region, kunde_id, bewerbungen_token')
    .eq('bewerbungen_token', token)
    .maybeSingle();
  return data;
}

// GET /api/public/bewerbungen/:token — Liste für den Kunden
router.get('/bewerbungen/:token', async (req, res) => {
  const job = await loadJobByToken(req.params.token);
  if (!job) return res.status(404).json({ error: 'Link ungültig oder abgelaufen.' });

  const { data: kunde } = await supabase
    .from('talentone_kunden')
    .select('id, firmenname, agentur, logo_url')
    .eq('id', job.kunde_id)
    .maybeSingle();

  const { data: bewerbungen, error } = await supabase
    .from('talentone_bewerbungen')
    .select('id, name, email, telefon, antworten, quelle, ko_kriterium, created_at')
    .eq('job_id', job.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  const ids = (bewerbungen || []).map(b => b.id);
  let feedback = {};
  let werte = {};
  if (ids.length > 0) {
    const [fb, w] = await Promise.all([
      supabase.from('talentone_bewerber_kundenfeedback').select('*').in('bewerbung_id', ids),
      supabase.from('talentone_bewerber_spalten_werte').select('*').in('bewerbung_id', ids),
    ]);
    for (const f of fb.data || []) feedback[f.bewerbung_id] = f;
    for (const x of w.data || []) {
      if (!werte[x.bewerbung_id]) werte[x.bewerbung_id] = {};
      werte[x.bewerbung_id][x.spalte_id] = x.wert;
    }
  }

  // Nur Kunden-sichtbare Spalten
  const { data: spalten } = await supabase
    .from('talentone_bewerber_spalten')
    .select('*')
    .eq('job_id', job.id)
    .eq('sichtbar_fuer', 'kunde')
    .order('reihenfolge', { ascending: true });

  res.json({
    job: { id: job.id, stelle: job.stelle, region: job.region },
    kunde: kunde ? { firmenname: kunde.firmenname, agentur: kunde.agentur, logo_url: kunde.logo_url } : null,
    bewerbungen: bewerbungen || [],
    feedback,
    spalten: spalten || [],
    werte,
  });
});

// POST /api/public/bewerbungen/:token/spalten  body: { name }
router.post('/bewerbungen/:token/spalten', async (req, res) => {
  const job = await loadJobByToken(req.params.token);
  if (!job) return res.status(404).json({ error: 'Link ungültig.' });
  const name = req.body?.name?.toString().trim();
  if (!name) return res.status(400).json({ error: 'name fehlt.' });

  const { data: last } = await supabase
    .from('talentone_bewerber_spalten')
    .select('reihenfolge')
    .eq('job_id', job.id)
    .order('reihenfolge', { ascending: false })
    .limit(1).maybeSingle();

  const { data, error } = await supabase
    .from('talentone_bewerber_spalten')
    .insert({
      job_id: job.id,
      name: name.slice(0, 80),
      typ: 'text',
      sichtbar_fuer: 'kunde',
      reihenfolge: (last?.reihenfolge ?? -1) + 1,
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ spalte: data });
});

// DELETE /api/public/bewerbungen/:token/spalten/:id
router.delete('/bewerbungen/:token/spalten/:id', async (req, res) => {
  const job = await loadJobByToken(req.params.token);
  if (!job) return res.status(404).json({ error: 'Link ungültig.' });

  const { data: spalte } = await supabase
    .from('talentone_bewerber_spalten').select('id, job_id, sichtbar_fuer')
    .eq('id', req.params.id).maybeSingle();
  if (!spalte || spalte.job_id !== job.id || spalte.sichtbar_fuer !== 'kunde') {
    return res.status(403).json({ error: 'Spalte gehört nicht zu diesem Link.' });
  }

  const { error } = await supabase
    .from('talentone_bewerber_spalten').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// PUT /api/public/bewerbungen/:token/:bewId/spalten/:spalteId  body: { wert }
router.put('/bewerbungen/:token/:bewId/spalten/:spalteId', async (req, res) => {
  const job = await loadJobByToken(req.params.token);
  if (!job) return res.status(404).json({ error: 'Link ungültig.' });

  const { data: bew } = await supabase
    .from('talentone_bewerbungen').select('id, job_id').eq('id', req.params.bewId).maybeSingle();
  if (!bew || bew.job_id !== job.id) return res.status(403).json({ error: 'Bewerbung gehört nicht.' });

  const { data: spalte } = await supabase
    .from('talentone_bewerber_spalten').select('id, job_id, sichtbar_fuer').eq('id', req.params.spalteId).maybeSingle();
  if (!spalte || spalte.job_id !== job.id || spalte.sichtbar_fuer !== 'kunde') {
    return res.status(403).json({ error: 'Spalte gehört nicht zu diesem Link.' });
  }

  const wert = req.body?.wert == null ? null : String(req.body.wert);
  const { data, error } = await supabase
    .from('talentone_bewerber_spalten_werte')
    .upsert({
      bewerbung_id: bew.id,
      spalte_id: spalte.id,
      wert,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'bewerbung_id,spalte_id' })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ wert: data });
});

// PATCH /api/public/bewerbungen/:token/:bewId  body: { status?, vorstellungsgespraech_am?, notizen? }
router.patch('/bewerbungen/:token/:bewId', async (req, res) => {
  const { data: job } = await supabase
    .from('talentone_jobs')
    .select('id, bewerbungen_token')
    .eq('bewerbungen_token', req.params.token)
    .maybeSingle();
  if (!job) return res.status(404).json({ error: 'Link ungültig.' });

  // Bewerbung muss zu diesem Job gehören
  const { data: bew } = await supabase
    .from('talentone_bewerbungen').select('id, job_id').eq('id', req.params.bewId).maybeSingle();
  if (!bew || bew.job_id !== job.id) return res.status(403).json({ error: 'Bewerbung gehört nicht zu diesem Link.' });

  const patch = { bewerbung_id: bew.id, updated_at: new Date().toISOString() };
  const body = req.body || {};
  if (body.status !== undefined) {
    patch.status = FEEDBACK_STATI.includes(body.status) ? body.status : 'neu';
  }
  if (body.vorstellungsgespraech_am !== undefined) {
    patch.vorstellungsgespraech_am = body.vorstellungsgespraech_am || null;
  }
  if (body.notizen !== undefined) {
    patch.notizen = body.notizen?.toString().trim() || null;
  }

  const { data, error } = await supabase
    .from('talentone_bewerber_kundenfeedback')
    .upsert(patch, { onConflict: 'bewerbung_id' })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ feedback: data });
});

export default router;
