// Public Routen — KEIN Login nötig, aber abgesichert per Token im Pfad.
// Wird in server.js OHNE requireAuth gemountet.

import { Router } from 'express';
import { supabase } from '../supabase.js';
import { uploadBuffer, deleteFromBucket, extFromMime, safeFilenameStem } from '../storage.js';
import { extractFromUrl, extractFromFile } from '../extractor.js';
import { extractColorsFromUrl, extractColorsFromImageBuffer } from '../colors.js';
import { sendFormularEingang, sendReviewBenachrichtigung, sendMentionMail, sendTeamAlertMail } from '../mail.js';
import { findMemberByName } from '../team.js';

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

  const { kunde: kundePatch = {}, job: jobPatch = {}, formdata = {}, projekttyp } = req.body || {};
  const istNeukunden = projekttyp === 'neukundengewinnung';
  if (!kundePatch.firmenname?.trim()) return res.status(400).json({ error: 'Firmenname ist Pflicht.' });
  if (!istNeukunden && !jobPatch.stelle?.trim()) return res.status(400).json({ error: 'Stelle ist Pflicht.' });
  if (istNeukunden && !(jobPatch.neukunden_daten?.produkt || '').trim()) {
    return res.status(400).json({ error: 'Produkt/Dienstleistung ist Pflicht.' });
  }

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

    // Job anlegen — für Neukundengewinnung sitzen die Text-Felder in
    // neukunden_daten (jsonb); für Mitarbeitergewinnung wie bisher.
    const jobRow = istNeukunden ? {
      kunde_id: kunde.id,
      projekttyp: 'neukundengewinnung',
      stelle: (jobPatch.neukunden_daten?.produkt || '').trim() || 'Neukunden-Kampagne',
      region: jobPatch.neukunden_daten?.einzugsgebiet?.trim() || null,
      benefits: Array.isArray(jobPatch.neukunden_daten?.vorteile) && jobPatch.neukunden_daten.vorteile.length
        ? jobPatch.neukunden_daten.vorteile : null,
      neukunden_daten: jobPatch.neukunden_daten || {},
      eingabe_methode: 'formular',
      formdata_komplett: formdata,
    } : {
      kunde_id: kunde.id,
      projekttyp: 'mitarbeitergewinnung',
      stelle: jobPatch.stelle.trim(),
      region: jobPatch.region?.trim() || null,
      gehalt: jobPatch.gehalt?.trim() || null,
      benefits: Array.isArray(jobPatch.benefits) && jobPatch.benefits.length ? jobPatch.benefits : null,
      besonderheiten: jobPatch.besonderheiten?.trim() || null,
      reisebereitschaft: !!jobPatch.reisebereitschaft,
      quereinsteiger: !!jobPatch.quereinsteiger,
      eingabe_methode: 'formular',
      formdata_komplett: formdata,
      vorqualifizierung: updated.agentur === 'nowagwirth',
    };
    const { data: job, error: jErr } = await supabase
      .from('talentone_jobs').insert(jobRow).select().single();
    if (jErr) return res.status(500).json({ error: `Job anlegen: ${jErr.message}` });

    // Antwort sofort raus
    res.status(201).json({ ok: true });

    // CAPI Lead-Event (best-effort, blockt nicht)
    if (process.env.META_PIXEL_ID && process.env.META_CAPI_TOKEN) {
      (async () => {
        try {
          const { sendCapiEvent } = await import('../capi.js');
          const clientIp = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || req.ip;
          await sendCapiEvent({
            pixelId: process.env.META_PIXEL_ID,
            accessToken: process.env.META_CAPI_TOKEN,
            eventName: 'Lead',
            eventSourceUrl: `${getPublicBaseUrl(updated.agentur)}/formular/${req.params.token}`,
            userData: {
              email: updated.email,
              phone: updated.telefon,
              clientIp,
              userAgent: req.headers['user-agent'],
              fbp: req.body?._fbp,
              fbc: req.body?._fbc,
            },
            customData: { content_name: 'Briefing-Formular', source: updated.firmenname },
          });
        } catch (err) { console.warn('[CAPI/formular]', err.message); }
      })().catch(err => console.error('[CAPI/formular-uncaught]', err.message));
    }

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

      // Mitarbeiter benachrichtigen (mit allen Daten + Branding der Agentur)
      try {
        await sendFormularEingang({
          kunde: updated,
          job,
          formdata,
          kundeUrl: `${getPublicBaseUrl('talentone')}/kunden/${kunde.id}/jobs/${job.id}/stelle`,
        });
      } catch (err) { console.warn('[formular-bg] Mitarbeiter-Mail:', err.message); }

      // Kreativ-Team-Alert: „🎨 Neuer Kunde — Creatives können erstellt werden".
      // Idempotent per creative_auftrag_gesendet_at am verknüpften Projekt.
      // Wir markieren am ersten passenden Projekt des Kunden — reicht als Guard.
      try {
        const { data: projekt } = await supabase
          .from('talentone_projekte')
          .select('id, creative_auftrag_gesendet_at')
          .eq('kunde_id', kunde.id)
          .is('creative_auftrag_gesendet_at', null)
          .limit(1).maybeSingle();
        if (projekt) {
          const insideBase = process.env.INSIDE_BASE_URL || 'https://inside.talent-one.de';
          await sendTeamAlertMail({
            subject:   `🎨 Neuer Kunde ${updated.firmenname} — Creatives können erstellt werden`,
            headline:  `Neuer Kunde: ${updated.firmenname}`,
            lead:      `${updated.firmenname} hat das Onboarding-Formular ausgefüllt und wurde auf status='aktiv' gesetzt. Bereit für Creative-Erstellung.`,
            linkUrl:   `${insideBase}/projekte?open=${projekt.id}`,
            linkLabel: 'Zum Projekt',
          });
          await supabase.from('talentone_projekte')
            .update({ creative_auftrag_gesendet_at: new Date().toISOString() })
            .eq('id', projekt.id);
        }
      } catch (err) { console.warn('[formular-bg] Team-Alert:', err.message); }
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
  // Alle Runden absteigend — neueste zuerst. `review` ist die aktuelle
  // (höchste runde) und wird vom Kunden bearbeitet; `vorherige_runden`
  // sind einklappbar sichtbar (abgeschlossene ältere Iterationen).
  const { data: alleReviews = [] } = await supabase
    .from('talentone_reviews').select('*').eq('job_id', job.id)
    .order('runde', { ascending: false });
  const review = alleReviews[0] || null;
  const vorherige_runden = alleReviews.slice(1);

  res.json({
    job: { id: job.id, stelle: job.stelle, region: job.region },
    kunde,
    creatives,
    adcopies,
    funnel_url: funnelUrl,
    sheet_url: sheetUrl,
    review,
    vorherige_runden,
  });
});

// POST /api/public/review/:token  body: { status, kommentare }
router.post('/review/:token', async (req, res) => {
  const { status, kommentare } = req.body || {};
  if (!['freigegeben', 'aenderungen'].includes(status)) {
    return res.status(400).json({ error: 'status muss "freigegeben" oder "aenderungen" sein.' });
  }
  const { data: job } = await supabase
    .from('talentone_jobs').select('*').eq('review_token', req.params.token).maybeSingle();
  if (!job) return res.status(404).json({ error: 'Link ungültig.' });

  // AKTUELLE Runde (höchste runde) suchen. Bei mehreren Runden bearbeitet
  // der Kunde immer die neueste — alte Runden bleiben archiviert.
  const { data: existing } = await supabase
    .from('talentone_reviews').select('id, runde').eq('job_id', job.id)
    .order('runde', { ascending: false }).limit(1).maybeSingle();

  // Snapshot der referenzierten Creatives + Adcopies zum Zeitpunkt des Reviews
  // → bleibt erhalten auch wenn Creatives später regeneriert/gelöscht werden.
  const [{ data: creativesNow = [] }, { data: adcopiesNow = [] }] = await Promise.all([
    supabase.from('talentone_creatives').select('id, bild_url, format, typ').eq('job_id', job.id),
    supabase.from('talentone_adcopies').select('id, stil').eq('job_id', job.id),
  ]);
  const kommentare_snapshot = {};
  for (const key of Object.keys(kommentare || {})) {
    if (key.startsWith('creative_')) {
      const id = key.slice('creative_'.length);
      const c = creativesNow.find(x => x.id === id);
      if (c) kommentare_snapshot[key] = { bild_url: c.bild_url, format: c.format, typ: c.typ };
    } else if (key.startsWith('adcopy_')) {
      const id = key.slice('adcopy_'.length);
      const a = adcopiesNow.find(x => x.id === id);
      if (a) kommentare_snapshot[key] = { stil: a.stil };
    }
  }

  let savedReview;
  if (existing) {
    const { data, error } = await supabase
      .from('talentone_reviews')
      .update({ status, kommentare: kommentare || null, kommentare_snapshot })
      .eq('id', existing.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    savedReview = data;
  } else {
    const { data, error } = await supabase
      .from('talentone_reviews')
      .insert({ job_id: job.id, token: req.params.token, status, kommentare: kommentare || null, kommentare_snapshot })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    savedReview = data;
  }

  // Mitarbeiter benachrichtigen (best-effort, blockt nicht) +
  // Projekt-Kommentar + automatischer Status-Wechsel
  (async () => {
    try {
      const { data: kunde } = await supabase
        .from('talentone_kunden').select('*').eq('id', job.kunde_id).maybeSingle();
      // Creatives + Adcopies laden, damit die Mail Thumbnails + Style-Labels zeigen kann
      const [{ data: creatives = [] }, { data: adcopies = [] }] = await Promise.all([
        supabase.from('talentone_creatives').select('id, bild_url, format, typ').eq('job_id', job.id),
        supabase.from('talentone_adcopies').select('id, stil, text').eq('job_id', job.id),
      ]);
      const jobUrl = `${getPublicBaseUrl('talentone')}/kunden/${job.kunde_id}/jobs/${job.id}/export`;
      await sendReviewBenachrichtigung({ kunde, job, status, kommentare, jobUrl, creatives, adcopies, snapshot: kommentare_snapshot });

      // ── Projekt-Sync: Kommentar + Status-Wechsel + Mail an Verantwortlichen ──
      try {
        await logFeedbackToProjekt({ kunde, job, status, kommentare, creatives, adcopies });
      } catch (err) { console.warn('[review-projekt-sync]', err.message); }
    } catch (err) { console.warn('[review-mail]', err.message); }
  })().catch(err => console.error('[review-mail-uncaught]', err.message));

  res.status(existing ? 200 : 201).json({ ok: true, review: savedReview });
});

/* ════════════════════ Public Bewerberliste (Token) ════════════════════ */

const FEEDBACK_STATI = ['neu', 'interessant', 'vorstellungsgespraech', 'eingestellt', 'ungeeignet', 'absage', 'abgesagt'];

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
  let recruiterSync = {};  // pro Bewerbung-ID: nur kundenrelevante Recruiter-Felder
  if (ids.length > 0) {
    const [fb, w, n] = await Promise.all([
      supabase.from('talentone_bewerber_kundenfeedback').select('*').in('bewerbung_id', ids),
      supabase.from('talentone_bewerber_spalten_werte').select('*').in('bewerbung_id', ids),
      supabase.from('talentone_bewerber_notizen')
        .select('bewerbung_id, status, vg_vereinbart_am, eingestellt, kunde_kontaktiert, ampel, updated_at')
        .in('bewerbung_id', ids),
    ]);
    for (const f of fb.data || []) feedback[f.bewerbung_id] = f;
    for (const x of w.data || []) {
      if (!werte[x.bewerbung_id]) werte[x.bewerbung_id] = {};
      werte[x.bewerbung_id][x.spalte_id] = x.wert;
    }
    for (const r of n.data || []) {
      recruiterSync[r.bewerbung_id] = {
        recruiter_status: r.status,
        vg_vereinbart_am: r.vg_vereinbart_am,
        eingestellt: r.eingestellt,
        kunde_kontaktiert: r.kunde_kontaktiert,
        ampel: r.ampel,
        updated_at: r.updated_at,
      };
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
    recruiter_sync: recruiterSync,
  });
});

// POST /api/public/bewerbungen/:token/spalten  body: { name, typ?, optionen? }
router.post('/bewerbungen/:token/spalten', async (req, res) => {
  const job = await loadJobByToken(req.params.token);
  if (!job) return res.status(404).json({ error: 'Link ungültig.' });
  const name = req.body?.name?.toString().trim();
  if (!name) return res.status(400).json({ error: 'name fehlt.' });
  const rawTyp = req.body?.typ;
  const typ = ['text', 'dropdown', 'datum'].includes(rawTyp) ? rawTyp : 'text';
  const rawOptionen = req.body?.optionen;
  const optionen = typ === 'dropdown' && Array.isArray(rawOptionen)
    ? rawOptionen.map(o => String(o).slice(0, 80)).filter(Boolean).slice(0, 30)
    : null;

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
      typ,
      optionen,
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

/* ════════════════════ Public Anfragen-Dashboard (Neukundengewinnung) ════════════════════
 * Analoges Muster wie Bewerbungen, aber mit Kunden-Anfragen aus dem
 * onepage.io-Webhook. Token: talentone_jobs.anfragen_token. */

async function loadJobByAnfragenToken(token) {
  const { data } = await supabase.from('talentone_jobs')
    .select('id, stelle, region, kunde_id, projekttyp, neukunden_daten, anfragen_token')
    .eq('anfragen_token', token).maybeSingle();
  return data;
}

// GET /api/public/anfragen/:token — Liste + Job-Meta + Kunden-Branding
router.get('/anfragen/:token', async (req, res) => {
  const job = await loadJobByAnfragenToken(req.params.token);
  if (!job) return res.status(404).json({ error: 'Link ungültig.' });
  const { data: kunde } = await supabase.from('talentone_kunden')
    .select('firmenname, agentur, logo_url, farben').eq('id', job.kunde_id).maybeSingle();
  const { data: anfragen = [] } = await supabase.from('talentone_anfragen')
    .select('*').eq('job_id', job.id).order('created_at', { ascending: false });
  res.json({
    job: {
      id: job.id, stelle: job.stelle, region: job.region,
      produkt: job.neukunden_daten?.produkt || job.stelle,
      projekttyp: job.projekttyp,
    },
    kunde,
    anfragen,
  });
});

// PATCH /api/public/anfragen/:token/:anfrageId  body: { status?, notizen? }
router.patch('/anfragen/:token/:anfrageId', async (req, res) => {
  const job = await loadJobByAnfragenToken(req.params.token);
  if (!job) return res.status(404).json({ error: 'Link ungültig.' });
  const { status, notizen } = req.body || {};
  const patch = {};
  if (status !== undefined) {
    if (!['neu', 'kontaktiert', 'termin', 'gewonnen', 'verloren'].includes(status)) {
      return res.status(400).json({ error: 'status ungültig.' });
    }
    patch.status = status;
  }
  if (notizen !== undefined) patch.notizen = notizen == null ? null : String(notizen);
  const { data, error } = await supabase.from('talentone_anfragen')
    .update(patch).eq('id', req.params.anfrageId).eq('job_id', job.id)
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ anfrage: data });
});

/* ════════════════════════════════════════════════════════════════
 * Review → Projekt-Sync
 * Findet das Projekt zum Kunden/Job, legt einen Auto-Kommentar an,
 * setzt den Status auf 'feedbackschleife' oder 'go' und benachrichtigt
 * den Verantwortlichen per Mail. Alles best-effort.
 * ════════════════════════════════════════════════════════════════ */
const STIL_LABEL = { emotional: 'Emotional', benefit: 'Benefits', kompakt: 'Knackig' };
const FORMAT_LABEL = { quadrat: '1:1', story: '9:16' };

async function findProjektForJob(job, kunde) {
  if (!kunde && !job?.kunde_id) return null;
  // 1) Direkter Match via kunde_id
  if (job?.kunde_id) {
    const { data } = await supabase
      .from('talentone_projekte').select('*')
      .eq('kunde_id', job.kunde_id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (data) return data;
  }
  // 2) Fallback via firmenname (case-insensitive)
  if (kunde?.firmenname) {
    const { data } = await supabase
      .from('talentone_projekte').select('*')
      .ilike('kunde', kunde.firmenname)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (data) return data;
  }
  return null;
}

function buildFeedbackKommentar({ status, kunde, kommentare, creatives, adcopies }) {
  const firma = kunde?.firmenname || 'Der Kunde';
  if (status === 'freigegeben') {
    const datum = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return `✅ Kunde ${firma} hat die Entwürfe freigegeben am ${datum}.`;
  }
  // status === 'aenderungen'
  const eintraege = [];
  for (const [key, raw] of Object.entries(kommentare || {})) {
    const txt = (raw || '').trim();
    if (!txt) continue;
    if (key.startsWith('creative_')) {
      const id = key.slice('creative_'.length);
      const c = creatives.find(x => x.id === id);
      const label = c
        ? `Creative ${FORMAT_LABEL[c.format] || c.format || ''}${c.typ === 'video' ? ' (Reel)' : ''}`.trim()
        : 'Creative';
      eintraege.push(`• ${label}: ${txt}`);
    } else if (key.startsWith('adcopy_')) {
      const id = key.slice('adcopy_'.length);
      const a = adcopies.find(x => x.id === id);
      const label = a ? `Ad Copy ${STIL_LABEL[a.stil] || a.stil}` : 'Ad Copy';
      eintraege.push(`• ${label}: ${txt}`);
    } else if (key === 'funnel') {
      eintraege.push(`• Funnel: ${txt}`);
    } else if (key === 'general' || key === 'allgemein') {
      eintraege.push(`• Allgemein: ${txt}`);
    } else {
      eintraege.push(`• ${key}: ${txt}`);
    }
  }
  const body = eintraege.length
    ? eintraege.join('\n\n')
    : '(Keine spezifischen Anmerkungen — siehe Review-Seite)';
  return `📝 Kunde ${firma} hat Änderungswünsche zu den Entwürfen gesendet:\n\n${body}`;
}

async function logFeedbackToProjekt({ kunde, job, status, kommentare, creatives, adcopies }) {
  const projekt = await findProjektForJob(job, kunde);
  if (!projekt) {
    console.log(`[review-projekt-sync] Kein Projekt zu Kunde ${kunde?.firmenname || job?.kunde_id} gefunden — skip.`);
    return;
  }

  // 1) Auto-Kommentar
  const text = buildFeedbackKommentar({ status, kunde, kommentare, creatives, adcopies });
  await supabase.from('talentone_kommentare').insert({
    projekt_id: projekt.id,
    autor: 'Kundenfeedback',
    text,
    quelle: 'review',
    erwaehnungen: projekt.verantwortlich ? [projekt.verantwortlich] : [],
  });

  // 2) Status-Wechsel — aenderungen → feedbackschleife;
  //    freigegeben → go (außer Projekt ist schon live, dann unverändert)
  let newStatus = null;
  if (status === 'aenderungen') {
    newStatus = 'feedbackschleife';
  } else if (status === 'freigegeben' && projekt.status !== 'live') {
    newStatus = 'go';
  }
  if (newStatus && newStatus !== projekt.status) {
    await supabase.from('talentone_projekte')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', projekt.id);
    console.log(`[review-projekt-sync] Projekt ${projekt.id.slice(0,8)} → status=${newStatus}`);
  }

  // 3) E-Mail an Verantwortlichen (best-effort, nur bei Änderungen)
  if (status === 'aenderungen' && projekt.verantwortlich) {
    try {
      const member = findMemberByName(projekt.verantwortlich);
      if (member?.email) {
        const projektUrl = `${process.env.PUBLIC_BASE_URL || 'https://inside.talent-one.de'}/projekte?id=${projekt.id}`;
        await sendMentionMail({
          to: member.email,
          mentionedName: projekt.verantwortlich,
          autor: 'Kundenfeedback',
          projektName: projekt.projekt || projekt.kunde || 'Projekt',
          kommentar: text,
          projektUrl,
        });
      }
    } catch (err) { console.warn('[review-projekt-sync] mention-mail:', err.message); }
  }
}

export default router;
