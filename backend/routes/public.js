// Public Routen — KEIN Login nötig, aber abgesichert per Token im Pfad.
// Wird in server.js OHNE requireAuth gemountet.

import { Router } from 'express';
import { supabase } from '../supabase.js';
import { effektiveVorqualFelder } from '../vorqualifizierung.js';
import { normalizeKriterien, kundenVorqualSpalten, syncKriterienMitFeldern } from '../kriterien.js';
import { uploadBuffer, deleteFromBucket, safeFilenameStem } from '../storage.js';
import { normalizeImageForStorage } from '../imageops.js';
import { extractFromUrl, extractFromFile } from '../extractor.js';
import { extractColorsFromUrl, extractColorsFromImageBuffer } from '../colors.js';
import { sendFormularEingang, sendReviewBenachrichtigung, sendMentionMail, sendTeamAlertMail } from '../mail.js';
import { notifyKunde } from '../close.js';
import { findMemberByName } from '../team.js';
import { protokolliereAnnahme, getAktuelleVersion, getAnnahme } from '../avv.js';
import { getPersonalizedAvvPdf } from '../avv-pdf.js';

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
    .select('id, firmenname, ansprechpartner, logo_url, agentur, anrede_form, anrede_titel, nachname')
    .eq('upload_token', req.params.token)
    .maybeSingle();
  if (!kunde) return res.status(404).json({ error: 'Link ungültig oder abgelaufen.' });
  res.json({
    kunde: {
      firmenname: kunde.firmenname,
      ansprechpartner: kunde.ansprechpartner,
      agentur: kunde.agentur || 'talentone',
      hat_logo: !!kunde.logo_url,
      anrede_form: kunde.anrede_form,
      anrede_titel: kunde.anrede_titel,
      nachname: kunde.nachname,
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
    const roh = Buffer.from(fileData, 'base64');
    // Beim Upload einmalig sauber machen (sRGB, EXIF-Rotation, web-taugliches
    // Format). Danach ist die Datei fuer Generierung, Vorschau und Canva ok.
    const norm = await normalizeImageForStorage(roh, { kind: typ, label: fileName });
    const buffer = norm.buffer;
    const stem = safeFilenameStem(fileName);
    const path = `${kunde.id}/${Date.now()}-${stem}.${norm.ext}`;

    if (typ === 'logo') {
      const publicUrl = await uploadBuffer({
        bucket: 'talentone-logos', path, buffer, contentType: norm.contentType,
      });
      // Altes Logo aufräumen
      if (kunde.logo_url) {
        const { deleteFromBucket } = await import('../storage.js');
        await deleteFromBucket('talentone-logos', kunde.logo_url);
      }
      // logo_transparent_url synchron nullen — sonst nutzt die Creative-Generierung
      // im Zwischenfenster bis zur (async) Regen noch die alte transparente Version.
      await supabase.from('talentone_kunden').update({ logo_url: publicUrl, logo_transparent_url: null, logo_uploaded_at: new Date().toISOString() }).eq('id', kunde.id);
      // Transparente Version im Hintergrund vorbereiten
      (async () => {
        try {
          const [{ deleteFromBucket }, { prepareAndSaveTransparentLogo }] = await Promise.all([
            import('../storage.js'), import('../logo.js'),
          ]);
          await prepareAndSaveTransparentLogo(kunde.id, buffer, { supabase, uploadBuffer, deleteFromBucket });
        } catch (err) { console.warn('[public-upload] transparent-Logo:', err.message); }
      })();
      // zusätzlich in talentone_referenzbilder als typ=logo loggen, damit der Mitarbeiter den Verlauf sieht
      await supabase.from('talentone_referenzbilder').insert({
        kunde_id: kunde.id, bild_url: publicUrl, typ: 'logo', uploaded_via: 'kunde',
      });
      return res.status(201).json({ ok: true, typ: 'logo', bild_url: publicUrl });
    }

    // typ === 'foto'
    const publicUrl = await uploadBuffer({
      bucket: 'talentone-referenzbilder', path, buffer, contentType: norm.contentType,
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
    res.status(400).json({ error: err.userMessage || err.message });
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
  // Falls beim Anlegen bereits ein „wartender" Job existiert (quick-create
  // mode='formular'), liefern wir dessen projekttyp mit — die Public-Formular-
  // Seite wählt danach die richtige Variante (Recruiting vs. Neukunden).
  const { data: pendingJob } = await supabase
    .from('talentone_jobs')
    .select('id, projekttyp, formdata_komplett')
    .eq('kunde_id', kunde.id)
    .contains('formdata_komplett', { _wartet_auf_briefing: true })
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  const avvVersion = await getAktuelleVersion(kunde.agentur);
  const avvPdfUrl = (await getPersonalizedAvvPdf(kunde.id)).url || avvVersion?.pdf_url || null;
  res.json({
    kunde: {
      firmenname: kunde.firmenname,
      ansprechpartner: kunde.ansprechpartner,
      email: kunde.email,
      agentur: kunde.agentur || 'talentone',
      anrede_form: kunde.anrede_form,
      anrede_titel: kunde.anrede_titel,
      nachname: kunde.nachname,
    },
    projekttyp: pendingJob?.projekttyp || 'mitarbeitergewinnung',
    avv: { version: avvVersion?.version || null, pdf_url: avvPdfUrl },
  });
});

// POST /api/public/formular/:token/extract  body: { mode: 'url'|'file', url?, fileType?, fileData? }
// Liefert die KI-extrahierten Felder (Vorausfüllung), kein DB-Update.
router.post('/formular/:token/extract', async (req, res) => {
  const kunde = await loadKundeByToken(req.params.token);
  if (!kunde) return res.status(404).json({ error: 'Link ungültig.' });
  if (kunde.status === 'aktiv') return res.status(410).json({ error: 'Bereits ausgefüllt.' });

  try {
    const { mode, projekttyp } = req.body || {};
    const opts = { projekttyp: projekttyp === 'neukundengewinnung' ? 'neukundengewinnung' : 'mitarbeitergewinnung' };
    let extracted;
    if (mode === 'url') {
      if (!req.body.url) return res.status(400).json({ error: 'URL fehlt.' });
      extracted = await extractFromUrl(req.body.url, opts);
    } else if (mode === 'file') {
      if (!req.body.fileData || !req.body.fileType) return res.status(400).json({ error: 'fileData / fileType fehlt.' });
      extracted = await extractFromFile(req.body.fileData, req.body.fileType, opts);
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
    const roh = Buffer.from(fileData, 'base64');
    const norm = await normalizeImageForStorage(roh, { kind: 'logo', label: fileName });
    const buffer = norm.buffer;
    const stem = safeFilenameStem(fileName);
    const path = `${kunde.id}/${Date.now()}-${stem}.${norm.ext}`;
    const publicUrl = await uploadBuffer({ bucket: 'talentone-logos', path, buffer, contentType: norm.contentType });
    if (kunde.logo_url) await deleteFromBucket('talentone-logos', kunde.logo_url);
    // logo_transparent_url synchron nullen (siehe Upload-Handler oben) — aktuelles
    // Logo wird sonst bis zur async Regen nicht in neue Creatives übernommen.
    await supabase.from('talentone_kunden').update({ logo_url: publicUrl, logo_transparent_url: null, logo_uploaded_at: new Date().toISOString() }).eq('id', kunde.id);
    (async () => {
      try {
        const { prepareAndSaveTransparentLogo } = await import('../logo.js');
        await prepareAndSaveTransparentLogo(kunde.id, buffer, { supabase, uploadBuffer, deleteFromBucket });
      } catch (err) { console.warn('[formular/logo] transparent:', err.message); }
    })();
    res.status(201).json({ logo_url: publicUrl });
  } catch (err) {
    console.error('[formular/logo]', err.message);
    res.status(400).json({ error: err.userMessage || err.message });
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
    const roh = Buffer.from(fileData, 'base64');
    const norm = await normalizeImageForStorage(roh, { kind: 'foto', label: fileName });
    const stem = safeFilenameStem(fileName);
    const path = `${kunde.id}/${Date.now()}-${stem}.${norm.ext}`;
    const publicUrl = await uploadBuffer({ bucket: 'talentone-referenzbilder', path, buffer: norm.buffer, contentType: norm.contentType });
    const { data: row, error: insErr } = await supabase
      .from('talentone_referenzbilder').insert({
        kunde_id: kunde.id, bild_url: publicUrl, typ: 'foto',
        beschreibung: beschreibung || null, uploaded_via: 'kunde',
      }).select().single();
    if (insErr) return res.status(500).json({ error: insErr.message });
    res.status(201).json({ referenzbild: row });
  } catch (err) {
    console.error('[formular/foto]', err.message);
    res.status(400).json({ error: err.userMessage || err.message });
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
  if (req.body?.avv_akzeptiert !== true) {
    return res.status(400).json({ error: 'Bitte den Auftragsverarbeitungsvertrag akzeptieren.' });
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
    // Wenn beim NewProjectModal ein „wartender" Job angelegt wurde
    // (formdata_komplett._wartet_auf_briefing=true), UPDATEN wir diesen
    // statt einen zweiten Job zu erzeugen.
    const { data: pending } = await supabase
      .from('talentone_jobs')
      .select('id')
      .eq('kunde_id', kunde.id)
      .contains('formdata_komplett', { _wartet_auf_briefing: true })
      .order('created_at', { ascending: false }).limit(1).maybeSingle();

    let job, jErr;
    if (pending) {
      ({ data: job, error: jErr } = await supabase
        .from('talentone_jobs').update(jobRow).eq('id', pending.id).select().single());
    } else {
      ({ data: job, error: jErr } = await supabase
        .from('talentone_jobs').insert(jobRow).select().single());
    }
    if (jErr) return res.status(500).json({ error: `Job speichern: ${jErr.message}` });

    // AVV-Annahme protokollieren (Checkbox war Pflicht). Best-effort — bricht das
    // Onboarding nicht ab, falls die Protokollierung mal scheitert.
    try {
      await protokolliereAnnahme({
        kunde: updated,
        akzeptiert_von: kundeUpdate.ansprechpartner || kundePatch.firmenname,
        akzeptiert_email: req.body?.avv_email || updated.email,
        req,
      });
    } catch (e) { console.warn('[formular/submit avv]', e.message); }

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

      // Close-Note (best-effort)
      notifyKunde(updated, `✅ Kunde hat das Briefing-Formular ausgefüllt am ${new Date().toLocaleDateString('de-DE')}`)
        .catch(err => console.warn('[formular-bg close-note]', err.message));

      // Kreativ-Team-Alert: reiche Mail mit Briefing + Foto-Status + Link.
      // Idempotent per creative_auftrag_gesendet_at am verknüpften Projekt.
      try {
        const { data: projekt } = await supabase
          .from('talentone_projekte')
          .select('id, live_termin, creative_auftrag_gesendet_at')
          .eq('kunde_id', kunde.id)
          .is('creative_auftrag_gesendet_at', null)
          .limit(1).maybeSingle();
        if (projekt) {
          const insideBase = process.env.INSIDE_BASE_URL || 'https://inside.talent-one.de';
          const { data: refCount } = await supabase.from('talentone_referenzbilder')
            .select('id', { count: 'exact', head: true }).eq('kunde_id', kunde.id);
          const fotosVorhanden = (refCount?.length ?? refCount ?? 0) > 0;
          const { sendCreativeAuftragMail } = await import('../mail.js');
          await sendCreativeAuftragMail({
            kunde: updated, job, projekt, fotosVorhanden,
            creativesUrl: `${insideBase}/kunden/${kunde.id}/jobs/${job.id}/creatives`,
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
    .select('id, firmenname, branche, logo_url, farben, agentur, ansprechpartner, anrede_form, anrede_titel, nachname')
    .eq('id', job.kunde_id).maybeSingle();
  const { data: creatives = [] } = await supabase
    .from('talentone_creatives').select('*').eq('job_id', job.id)
    .neq('archiviert', true)
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
  // Kontext: 'entwurf' (Standard) oder 'update' (Kampagnen-Update während Live-Phase).
  // Getrennte Runden-Ströme über dasselbe review_token.
  const kontext = req.query.kontext === 'update' ? 'update' : 'entwurf';
  // Alle Runden des Kontexts absteigend — neueste zuerst. `review` ist die aktuelle
  // (höchste runde) und wird vom Kunden bearbeitet; `vorherige_runden`
  // sind einklappbar sichtbar (abgeschlossene ältere Iterationen).
  const { data: alleReviews = [] } = await supabase
    .from('talentone_reviews').select('*').eq('job_id', job.id).eq('kontext', kontext)
    .order('runde', { ascending: false });
  const review = alleReviews[0] || null;
  const vorherige_runden = alleReviews.slice(1);

  // AVV-Status für die Click-Wrap-Checkbox auf der Review-Seite. `erforderlich`
  // = es gibt eine aktive Version UND der Kunde hat noch nicht akzeptiert.
  const avvVersion = kunde ? await getAktuelleVersion(kunde.agentur) : null;
  const avvAnnahme = kunde ? await getAnnahme(kunde.id) : null;
  // Personalisierte Fassung (Firmenname/Anschrift eingesetzt); Fallback Master.
  const avvPdfUrl = kunde
    ? (avvAnnahme?.pdf_url || (await getPersonalizedAvvPdf(kunde.id)).url || avvVersion?.pdf_url || null)
    : null;
  const avv = {
    erforderlich: !!avvVersion && !avvAnnahme,
    akzeptiert: !!avvAnnahme,
    version: avvVersion?.version || null,
    pdf_url: avvPdfUrl,
    firmenname: kunde?.firmenname || null,
  };

  res.json({
    job: { id: job.id, stelle: job.stelle, region: job.region },
    kunde,
    creatives,
    adcopies,
    funnel_url: funnelUrl,
    sheet_url: sheetUrl,
    review,
    vorherige_runden,
    kontext,
    avv,
  });
});

// POST /api/public/review/:token  body: { status, kommentare, kontext?, avv_akzeptiert?, avv_name? }
router.post('/review/:token', async (req, res) => {
  const { status, kommentare, avv_akzeptiert, avv_name } = req.body || {};
  const kontext = (req.body?.kontext === 'update' || req.query.kontext === 'update') ? 'update' : 'entwurf';
  if (!['freigegeben', 'aenderungen'].includes(status)) {
    return res.status(400).json({ error: 'status muss "freigegeben" oder "aenderungen" sein.' });
  }
  const { data: job } = await supabase
    .from('talentone_jobs').select('*').eq('review_token', req.params.token).maybeSingle();
  if (!job) return res.status(404).json({ error: 'Link ungültig.' });

  // ── AVV-Click-Wrap: eigene, explizite Zustimmung (KEINE stille Kopplung an die
  // Freigabe). Wenn eine aktive AVV-Version existiert und noch keine Annahme
  // vorliegt, ist der Haken Pflicht — sonst kein Absenden. Wird sofort und
  // vollstaendig protokolliert (protokolliereAnnahme: Bestaetigungsmail, Check-
  // liste, Close-Note). Eine Quelle fuer alle Tueren. */
  const { data: avvKunde } = await supabase
    .from('talentone_kunden').select('*').eq('id', job.kunde_id).maybeSingle();
  const avvVersion = avvKunde ? await getAktuelleVersion(avvKunde.agentur) : null;
  const avvBereitsAkzeptiert = avvKunde ? !!(await getAnnahme(avvKunde.id)) : false;
  const avvErforderlich = !!avvVersion && !avvBereitsAkzeptiert;
  if (avvErforderlich) {
    if (avv_akzeptiert !== true || !String(avv_name || '').trim()) {
      return res.status(400).json({
        error: 'Bitte den Auftragsverarbeitungsvertrag bestätigen (Haken setzen und Namen angeben).',
      });
    }
    try {
      await protokolliereAnnahme({
        kunde: avvKunde,
        akzeptiert_von: String(avv_name).trim(),
        akzeptiert_email: avvKunde.email,
        req,
      });
    } catch (e) {
      console.error('[review avv]', e.message);
      return res.status(500).json({ error: `AVV-Zustimmung konnte nicht gespeichert werden: ${e.message}` });
    }
  }

  // AKTUELLE Runde (höchste runde) des jeweiligen Kontexts suchen. Bei mehreren
  // Runden bearbeitet der Kunde immer die neueste — alte Runden bleiben archiviert.
  const { data: existing } = await supabase
    .from('talentone_reviews').select('id, runde').eq('job_id', job.id).eq('kontext', kontext)
    .order('runde', { ascending: false }).limit(1).maybeSingle();

  // Snapshot der referenzierten Creatives + Adcopies zum Zeitpunkt des Reviews
  // → bleibt erhalten auch wenn Creatives später regeneriert/gelöscht werden.
  const [{ data: creativesNow = [] }, { data: adcopiesNow = [] }] = await Promise.all([
    supabase.from('talentone_creatives').select('id, bild_url, format, typ').eq('job_id', job.id).neq('archiviert', true),
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
      .insert({ job_id: job.id, token: req.params.token, kontext, status, kommentare: kommentare || null, kommentare_snapshot })
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
        supabase.from('talentone_creatives').select('id, bild_url, format, typ').eq('job_id', job.id).neq('archiviert', true),
        supabase.from('talentone_adcopies').select('id, stil, text').eq('job_id', job.id),
      ]);
      const jobUrl = `${getPublicBaseUrl('talentone')}/kunden/${job.kunde_id}/jobs/${job.id}/export`;
      await sendReviewBenachrichtigung({ kunde, job, status, kommentare, jobUrl, creatives, adcopies, snapshot: kommentare_snapshot });

      // Close-Note (best-effort)
      const kundenText = status === 'freigegeben'
        ? `✅ Kunde hat Entwürfe freigegeben am ${new Date().toLocaleDateString('de-DE')}`
        : `📝 Kunde hat Änderungswünsche gesendet am ${new Date().toLocaleDateString('de-DE')}`;
      notifyKunde(kunde, kundenText)
        .catch(err => console.warn('[review close-note]', err.message));

      // ── Projekt-Sync: Kommentar + Status-Wechsel + Mail an Verantwortlichen ──
      try {
        await logFeedbackToProjekt({ kunde, job, status, kommentare, creatives, adcopies, kontext });
      } catch (err) { console.warn('[review-projekt-sync]', err.message); }
    } catch (err) { console.warn('[review-mail]', err.message); }
  })().catch(err => console.error('[review-mail-uncaught]', err.message));

  res.status(existing ? 200 : 201).json({ ok: true, review: savedReview });
});

/* ════════════════ Daten-Prüfung durch den Kunden (pruefung_token) ════════════════
   Der Kunde prüft/ergänzt die bereits erfassten Stellendaten. GET liefert den Job
   vorbefüllt; POST übernimmt die Änderungen DIREKT in den Job (kein manueller
   Übernahme-Schritt) und protokolliert einen Diff-Kommentar + Team-Mail. */

// Menschlich lesbaren Änderungs-Diff bauen.
function buildDatenDiff(oldJob, newJobVals, oldFd, newFd) {
  const lines = [];
  const cmp = (label, o, n) => {
    const os = (o ?? '').toString().trim();
    const ns = (n ?? '').toString().trim();
    if (os !== ns) lines.push(`${label}: „${os || '—'}" → „${ns || '—'}"`);
  };
  cmp('Stelle', oldJob.stelle, newJobVals.stelle);
  cmp('Region', oldJob.region, newJobVals.region);
  cmp('Gehalt', oldJob.gehalt, newJobVals.gehalt);
  cmp('Besonderheiten', oldJob.besonderheiten, newJobVals.besonderheiten);

  const ob = Array.isArray(oldJob.benefits) ? oldJob.benefits : [];
  const nb = Array.isArray(newJobVals.benefits) ? newJobVals.benefits : [];
  const added = nb.filter(x => !ob.includes(x));
  const removed = ob.filter(x => !nb.includes(x));
  if (added.length) lines.push(`Benefits ergänzt: ${added.join(', ')}`);
  if (removed.length) lines.push(`Benefits entfernt: ${removed.join(', ')}`);

  const fdLabels = {
    unterschied: 'Unterschied/USP', mitarbeiter_gerne: 'Warum man gerne hier arbeitet',
    unternehmenskultur: 'Unternehmenskultur', mitarbeiter_anzahl: 'Mitarbeiterzahl',
    ausbildung: 'Ausbildung', berufserfahrung: 'Berufserfahrung',
    kandidat_eigenschaften: 'Eigenschaften des Kandidaten',
    benefits_zusatz: 'Benefits (Freitext)', soft_skills_zusatz: 'Soft Skills (Freitext)',
  };
  for (const [key, label] of Object.entries(fdLabels)) cmp(label, oldFd[key], newFd[key]);

  const oss = Array.isArray(oldFd.soft_skills) ? oldFd.soft_skills : [];
  const nss = Array.isArray(newFd.soft_skills) ? newFd.soft_skills : [];
  const sAdd = nss.filter(x => !oss.includes(x));
  const sRem = oss.filter(x => !nss.includes(x));
  if (sAdd.length) lines.push(`Soft Skills ergänzt: ${sAdd.join(', ')}`);
  if (sRem.length) lines.push(`Soft Skills entfernt: ${sRem.join(', ')}`);
  return lines;
}

// GET /api/public/pruefung/:token — Job vorbefüllt + Kunde + AVV-Status.
router.get('/pruefung/:token', async (req, res) => {
  const { data: job } = await supabase.from('talentone_jobs')
    .select('*').eq('pruefung_token', req.params.token).maybeSingle();
  if (!job) return res.status(404).json({ error: 'Link ungültig oder abgelaufen.' });
  const { data: kunde } = await supabase.from('talentone_kunden')
    .select('id, firmenname, ansprechpartner, telefon, website_url, branche, agentur, email, anrede_form, anrede_titel, nachname')
    .eq('id', job.kunde_id).maybeSingle();

  // AVV nach Review-Muster: nur erforderlich, wenn aktive Version existiert UND noch keine Annahme.
  const avvVersion = kunde ? await getAktuelleVersion(kunde.agentur) : null;
  const avvAnnahme = kunde ? await getAnnahme(kunde.id) : null;
  const avvPdfUrl = kunde
    ? (avvAnnahme?.pdf_url || (await getPersonalizedAvvPdf(kunde.id)).url || avvVersion?.pdf_url || null)
    : null;

  res.json({
    job: {
      id: job.id, stelle: job.stelle, region: job.region, gehalt: job.gehalt,
      benefits: Array.isArray(job.benefits) ? job.benefits : [],
      besonderheiten: job.besonderheiten || '',
      reisebereitschaft: job.reisebereitschaft, quereinsteiger: job.quereinsteiger,
      projekttyp: job.projekttyp || 'mitarbeitergewinnung',
      formdata_komplett: job.formdata_komplett || {},
      neukunden_daten: job.neukunden_daten || null,
    },
    kunde,
    avv: {
      erforderlich: !!avvVersion && !avvAnnahme,
      akzeptiert: !!avvAnnahme,
      version: avvVersion?.version || null,
      pdf_url: avvPdfUrl,
      firmenname: kunde?.firmenname || null,
    },
  });
});

// POST /api/public/pruefung/:token — Änderungen direkt in den Job übernehmen.
router.post('/pruefung/:token', async (req, res) => {
  const { kunde: kundePatch = {}, job: jobPatch = {}, formdata = {}, neukunden_daten, avv_akzeptiert, avv_name } = req.body || {};
  const { data: job } = await supabase.from('talentone_jobs')
    .select('*').eq('pruefung_token', req.params.token).maybeSingle();
  if (!job) return res.status(404).json({ error: 'Link ungültig.' });
  const { data: kunde } = await supabase.from('talentone_kunden').select('*').eq('id', job.kunde_id).maybeSingle();

  // AVV-Click-Wrap (nur wenn erforderlich)
  const avvVersion = kunde ? await getAktuelleVersion(kunde.agentur) : null;
  const avvBereits = kunde ? !!(await getAnnahme(kunde.id)) : false;
  if (!!avvVersion && !avvBereits) {
    if (avv_akzeptiert !== true || !String(avv_name || '').trim()) {
      return res.status(400).json({ error: 'Bitte den Auftragsverarbeitungsvertrag bestätigen (Haken setzen und Namen angeben).' });
    }
    try {
      await protokolliereAnnahme({ kunde, akzeptiert_von: String(avv_name).trim(), akzeptiert_email: kunde.email, req });
    } catch (e) {
      console.error('[pruefung avv]', e.message);
      return res.status(500).json({ error: `AVV-Zustimmung konnte nicht gespeichert werden: ${e.message}` });
    }
  }

  const oldFd = job.formdata_komplett || {};
  const newFd = { ...oldFd, ...formdata };
  const newBenefits = Array.isArray(jobPatch.benefits) ? jobPatch.benefits.filter(Boolean) : (job.benefits || []);
  const reiseBool = typeof jobPatch.reisebereitschaft === 'boolean'
    ? jobPatch.reisebereitschaft
    : (formdata.reisebereitschaft ? formdata.reisebereitschaft !== 'keine' : job.reisebereitschaft);
  const newJobVals = {
    stelle: (jobPatch.stelle ?? job.stelle) || job.stelle,
    region: jobPatch.region ?? job.region,
    gehalt: jobPatch.gehalt ?? job.gehalt,
    besonderheiten: jobPatch.besonderheiten ?? job.besonderheiten,
    benefits: newBenefits,
  };

  const diff = buildDatenDiff(job, newJobVals, oldFd, newFd);

  // Relevante Felder (Benefits/Stelle/Region) geändert → Creatives ggf. veraltet.
  const relevantChanged = (newJobVals.stelle !== job.stelle)
    || ((newJobVals.region || '') !== (job.region || ''))
    || (JSON.stringify(newBenefits) !== JSON.stringify(Array.isArray(job.benefits) ? job.benefits : []));
  let creativesVorhanden = false;
  if (relevantChanged) {
    const [{ count: cCount }, { count: aCount }] = await Promise.all([
      supabase.from('talentone_creatives').select('id', { count: 'exact', head: true }).eq('job_id', job.id).neq('archiviert', true),
      supabase.from('talentone_adcopies').select('id', { count: 'exact', head: true }).eq('job_id', job.id),
    ]);
    creativesVorhanden = (cCount || 0) > 0 || (aCount || 0) > 0;
  }

  const update = {
    stelle: newJobVals.stelle,
    region: newJobVals.region || null,
    gehalt: newJobVals.gehalt || null,
    besonderheiten: newJobVals.besonderheiten || null,
    benefits: newBenefits.length ? newBenefits : null,
    reisebereitschaft: reiseBool,
    quereinsteiger: typeof jobPatch.quereinsteiger === 'boolean' ? jobPatch.quereinsteiger : job.quereinsteiger,
    formdata_komplett: newFd,
  };
  if (neukunden_daten && typeof neukunden_daten === 'object') update.neukunden_daten = neukunden_daten;
  if (creativesVorhanden) update.daten_geaendert_nach_creatives_at = new Date().toISOString();
  const { error: updErr } = await supabase.from('talentone_jobs').update(update).eq('id', job.id);
  if (updErr) return res.status(500).json({ error: `Job aktualisieren: ${updErr.message}` });

  // Kunden-Felder, die der Kunde ergänzen darf.
  const kUpd = {};
  for (const f of ['ansprechpartner', 'telefon', 'website_url', 'branche']) {
    if (kundePatch[f] != null && (kundePatch[f] || '') !== (kunde?.[f] || '')) kUpd[f] = kundePatch[f] || null;
  }
  if (Object.keys(kUpd).length && kunde?.id) await supabase.from('talentone_kunden').update(kUpd).eq('id', kunde.id);

  res.json({ ok: true, creatives_warnung: creativesVorhanden });

  // Hintergrund: Diff-Kommentar am Projekt + interne Team-Mail (best-effort).
  (async () => {
    try {
      const projekt = await findProjektForJob(job, kunde);
      const diffText = diff.length ? diff.map(l => `• ${l}`).join('\n')
        : '(keine inhaltlichen Änderungen — Kunde hat die Angaben bestätigt)';
      const warnLine = creativesVorhanden
        ? '\n\n⚠️ Es existieren bereits Creatives/Ad Copies — bitte prüfen, ob sie noch zu den geänderten Daten passen.'
        : '';
      if (projekt) {
        await supabase.from('talentone_kommentare').insert({
          projekt_id: projekt.id,
          autor: 'Kunde (Daten-Prüfung)',
          text: `📋 Kunde hat die Stellendaten geprüft/ergänzt:\n\n${diffText}${warnLine}`,
          quelle: 'pruefung',
          erwaehnungen: projekt.verantwortlich ? [projekt.verantwortlich] : [],
        });
      }
      const insideBase = process.env.INSIDE_BASE_URL || 'https://inside.talent-one.de';
      await sendTeamAlertMail({
        subject: `📋 ${kunde?.firmenname || 'Kunde'} hat die Stellendaten geprüft${creativesVorhanden ? ' — ⚠️ Creatives prüfen' : ''}`,
        headline: 'Kunde hat die Daten-Prüfung abgeschlossen',
        lead: `${kunde?.firmenname || 'Kunde'} · ${newJobVals.stelle || 'Stelle'}\n\n${diffText}${warnLine}`,
        linkUrl: `${insideBase}/kunden/${job.kunde_id}/jobs/${job.id}/stelle`,
        linkLabel: 'Zum Stelle-Tab',
      });
    } catch (err) { console.warn('[pruefung-sync]', err.message); }
  })().catch(err => console.error('[pruefung-sync-uncaught]', err.message));
});

/* ════════════════════ Public Bewerberliste (Token) ════════════════════ */

const FEEDBACK_STATI = ['neu', 'interessant', 'vorstellungsgespraech', 'eingestellt', 'ungeeignet', 'absage', 'abgesagt'];

async function loadJobByToken(token) {
  const { data } = await supabase
    .from('talentone_jobs')
    // vorqualifizierung* + wichtige_kriterien werden fuer die Vorqual-Spalten
    // der Kunden-Ansicht gebraucht — fehlten hier bisher, deshalb konnte die
    // Tabelle sie gar nicht rendern.
    .select('id, stelle, region, kunde_id, bewerbungen_token, vorqualifizierung, vorqualifizierung_felder, wichtige_kriterien')
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
    .select('id, firmenname, agentur, logo_url, ansprechpartner, anrede_form, anrede_titel, nachname')
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
        .select('bewerbung_id, status, vg_vereinbart_am, eingestellt, kunde_kontaktiert, ampel, updated_at, gehaltswunsch, verfuegbarkeit, notizen, vorqualifizierung_werte, anrufversuche')
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
        // Vorqualifizierungs-Ergebnisse (kundenrelevant). NICHT durchgereicht:
        // bewertung (interne Sterne), naechste_aktion, interne Notiz je Anruf.
        vorqual_gehaltswunsch: r.gehaltswunsch || null,
        vorqual_verfuegbarkeit: r.verfuegbarkeit || null,
        vorqual_notiz: r.notizen || null,
        vorqualifizierung_werte: r.vorqualifizierung_werte || null,
        // Kontaktversuche belegen die Vorqualifizierungs-Arbeit — Datum + ob
        // erreicht (die interne Anruf-Notiz bleibt draussen).
        kontaktversuche: (Array.isArray(r.anrufversuche) ? r.anrufversuche : [])
          .filter(a => a?.datum)
          .map(a => ({ datum: a.datum, erreicht: a.ergebnis === 'erreicht' })),
        erreicht_am: (Array.isArray(r.anrufversuche) ? r.anrufversuche : [])
          .find(a => a?.datum && a.ergebnis === 'erreicht')?.datum || null,
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

  // Vorqual-Spalten fuer den Kunden: befuellte Felder + IMMER die wichtigen
  // Kriterien (auch leer). Berechnung zentral in kriterien.js.
  const felder = effektiveVorqualFelder(job);
  const kriterien = normalizeKriterien(job.wichtige_kriterien);
  const vorqualSpalten = kundenVorqualSpalten({
    felder,
    werte: Object.values(recruiterSync).map(r => r?.vorqualifizierung_werte || {}),
    kriterien,
  });

  res.json({
    job: {
      id: job.id, stelle: job.stelle, region: job.region,
      vorqualifizierung: !!job.vorqualifizierung,
    },
    kunde: kunde ? {
      firmenname: kunde.firmenname, agentur: kunde.agentur, logo_url: kunde.logo_url,
      ansprechpartner: kunde.ansprechpartner, anrede_form: kunde.anrede_form,
      anrede_titel: kunde.anrede_titel, nachname: kunde.nachname,
    } : null,
    bewerbungen: bewerbungen || [],
    feedback,
    spalten: spalten || [],
    werte,
    recruiter_sync: recruiterSync,
    vorqual_spalten: vorqualSpalten,
    wichtige_kriterien: kriterien,
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
  const changes = []; // fuer den internen Projekt-Kommentar
  if (body.status !== undefined) {
    patch.status = FEEDBACK_STATI.includes(body.status) ? body.status : 'neu';
    changes.push('Status');
  }
  if (body.vorstellungsgespraech_am !== undefined) {
    patch.vorstellungsgespraech_am = body.vorstellungsgespraech_am || null;
    changes.push('VG-Termin');
  }
  if (body.notizen !== undefined) {
    patch.notizen = body.notizen?.toString().trim() || null;
    changes.push('Notiz');
  }
  // Vom Kunden gepflegte Vorqual-/Kriterien-Werte (getrennte Ablage — überschreibt
  // die internen Recruiter-Werte NICHT).
  if (body.vorqual_werte_kunde !== undefined && body.vorqual_werte_kunde && typeof body.vorqual_werte_kunde === 'object') {
    const clean = {};
    for (const [k, v] of Object.entries(body.vorqual_werte_kunde)) {
      if (v != null && String(v).trim() !== '') clean[String(k)] = String(v).slice(0, 500);
    }
    patch.vorqual_werte_kunde = clean;
    changes.push('Vorqual-Feld');
  }

  const { data, error } = await supabase
    .from('talentone_bewerber_kundenfeedback')
    .upsert(patch, { onConflict: 'bewerbung_id' })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Interne Transparenz: Projekt-Kommentar (kein Mail-Spam). Best-effort.
  if (changes.length) {
    logKundenBewerberAenderung({ jobId: job.id, kundeId: job.kunde_id, bewId: bew.id, changes })
      .catch(err => console.warn('[bewerber-kunde-change]', err.message));
  }
  res.json({ feedback: data });
});

// Interner Projekt-Kommentar bei Kunden-Änderungen an Bewerbern (gebündelt pro
// PATCH, keine Mail). Spiegelt das Muster der Kriterien-/Review-Hinweise.
async function logKundenBewerberAenderung({ jobId, kundeId, bewId, changes }) {
  const { data: job } = await supabase.from('talentone_jobs').select('id, stelle, kunde_id').eq('id', jobId).maybeSingle();
  const { data: kunde } = await supabase.from('talentone_kunden').select('id, firmenname').eq('id', kundeId).maybeSingle();
  const projekt = await findProjektForJob(job, kunde);
  if (!projekt) return;
  const { data: bew } = await supabase.from('talentone_bewerbungen').select('name').eq('id', bewId).maybeSingle();
  const feld = [...new Set(changes)].join(', ');
  await supabase.from('talentone_kommentare').insert({
    projekt_id: projekt.id,
    autor: 'Kundenfeedback',
    text: `Kunde hat "${bew?.name || 'Bewerber'}": ${feld} geändert.`,
    quelle: 'bewerber',
    erwaehnungen: [],
  });
}

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
    .select('firmenname, agentur, logo_url, farben, ansprechpartner, anrede_form, anrede_titel, nachname').eq('id', job.kunde_id).maybeSingle();
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
// Status ist jetzt eine frei konfigurierbare Pipeline-Stufe (String-ID
// aus job.pipeline_stufen) — keine Whitelist mehr.
router.patch('/anfragen/:token/:anfrageId', async (req, res) => {
  const job = await loadJobByAnfragenToken(req.params.token);
  if (!job) return res.status(404).json({ error: 'Link ungültig.' });
  const { status, notizen } = req.body || {};
  const patch = {};
  if (status !== undefined) patch.status = String(status);
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

function buildFeedbackKommentar({ status, kunde, kommentare, creatives, adcopies, istUpdate }) {
  const firma = kunde?.firmenname || 'Der Kunde';
  if (status === 'freigegeben') {
    const datum = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return istUpdate
      ? `✅ Kunde ${firma} hat das Kampagnen-Update freigegeben am ${datum}.`
      : `✅ Kunde ${firma} hat die Entwürfe freigegeben am ${datum}.`;
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
  return `📝 Kunde ${firma} hat Änderungswünsche ${istUpdate ? 'zum Kampagnen-Update' : 'zu den Entwürfen'} gesendet:\n\n${body}`;
}

async function logFeedbackToProjekt({ kunde, job, status, kommentare, creatives, adcopies, kontext }) {
  const projekt = await findProjektForJob(job, kunde);
  if (!projekt) {
    console.log(`[review-projekt-sync] Kein Projekt zu Kunde ${kunde?.firmenname || job?.kunde_id} gefunden — skip.`);
    return;
  }
  const istUpdate = kontext === 'update';
  // Live-Kampagne (Update-Feedback ODER Feedback auf ein bereits live geschaltetes
  // Projekt): Der Basis-Status bleibt 'live' — die laufende Kampagne fällt NICHT in
  // "Feedbackschleife" zurück. Gesteuert wird nur der Sub-Status update_feedback_status.
  const liveKampagne = istUpdate || projekt.status === 'live';

  // 1) Auto-Kommentar
  const text = buildFeedbackKommentar({ status, kunde, kommentare, creatives, adcopies, istUpdate });
  await supabase.from('talentone_kommentare').insert({
    projekt_id: projekt.id,
    autor: 'Kundenfeedback',
    text,
    quelle: 'review',
    erwaehnungen: projekt.verantwortlich ? [projekt.verantwortlich] : [],
  });

  // 2) Status-Wechsel
  if (liveKampagne) {
    // Status bleibt 'live' — nur Sub-Status: Freigabe hebt das offene Feedback auf,
    // Änderungswünsche → "Update-Überarbeitung".
    const patch = { updated_at: new Date().toISOString() };
    if (status === 'freigegeben') {
      patch.update_feedback_status = null;
      patch.update_feedback_seit = null;
    } else if (status === 'aenderungen') {
      patch.update_feedback_status = 'ueberarbeitung';
      if (!projekt.update_feedback_seit) patch.update_feedback_seit = new Date().toISOString();
    }
    await supabase.from('talentone_projekte').update(patch).eq('id', projekt.id);
    console.log(`[review-projekt-sync] Projekt ${projekt.id.slice(0,8)} bleibt live — update_feedback_status=${patch.update_feedback_status ?? 'null'}`);
  } else {
    // Entwurfs-Phase: aenderungen → feedbackschleife; freigegeben → go.
    let newStatus = null;
    if (status === 'aenderungen') newStatus = 'feedbackschleife';
    else if (status === 'freigegeben') newStatus = 'go';
    if (newStatus && newStatus !== projekt.status) {
      await supabase.from('talentone_projekte')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', projekt.id);
      console.log(`[review-projekt-sync] Projekt ${projekt.id.slice(0,8)} → status=${newStatus}`);
    }
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

/* ════════════════════ Portal — gebuendeltes Kunden-Dashboard ════════════════════
 * Token = talentone_kunden.portal_token. Liefert Kunde + Jobs + Anfragen +
 * Bewerbungen + Creatives + Funnel-Link + Pipeline-Stufen. Alle Sub-Aktionen
 * (Status setzen, Notizen, Kommentare, Pipeline anpassen, Ueberarbeitungs-
 * wunsch) laufen ebenfalls ueber /portal/:token/... */

const DEFAULT_PIPELINE = [
  { id: 'neu',       name: 'Neu',       farbe: '#6b7280', reihenfolge: 10 },
  { id: 'aktiv',     name: 'Aktiv',     farbe: '#3b82f6', reihenfolge: 20 },
  { id: 'angebot',   name: 'Angebot',   farbe: '#f59e0b', reihenfolge: 30 },
  { id: 'gewonnen',  name: 'Gewonnen',  farbe: '#16a34a', reihenfolge: 40 },
  { id: 'verloren',  name: 'Verloren',  farbe: '#dc2626', reihenfolge: 50 },
];

async function loadKundeByPortalToken(token) {
  const { data } = await supabase.from('talentone_kunden').select('*')
    .eq('portal_token', token).maybeSingle();
  return data;
}

// Prueft ob dieser Zugriff auf das Portal berechtigt ist. Bei portal_zugang=link
// reicht der Token; bei 'account' braucht es einen gueltigen Session-Cookie
// ODER eine gueltige interne Mitarbeiter-Session (Supabase-Bearer-Token).
async function requirePortalAccess(kunde, req) {
  if (kunde.portal_zugang !== 'account') return { ok: true, session: null };

  // 1) Interner Mitarbeiter: gueltiger Bearer-Token in Authorization-Header
  const auth = req.headers?.authorization || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const { data } = await supabase.auth.getUser(auth.slice(7));
      if (data?.user) return { ok: true, session: { staff: true, email: data.user.email } };
    } catch {}
  }

  // 2) Externer Kunde: Session-Cookie
  const { readSessionCookie } = await import('../portal-auth.js');
  const session = readSessionCookie(req, kunde.id);
  if (!session || session.kunde_id !== kunde.id) {
    return { ok: false, error: 'login_required' };
  }
  return { ok: true, session };
}

/* ── Login / Logout / Passwort setzen — laufen VOR dem Auth-Gate ── */

// POST /api/public/portal/:token/login  body: { email, password }
router.post('/portal/:token/login', async (req, res) => {
  const kunde = await loadKundeByPortalToken(req.params.token);
  if (!kunde) return res.status(404).json({ error: 'Link ungültig.' });
  if (kunde.portal_zugang !== 'account') return res.status(400).json({ error: 'Portal benötigt keinen Login.' });
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!email || !password) return res.status(400).json({ error: 'E-Mail und Passwort sind Pflicht.' });

  const { data: account } = await supabase.from('talentone_portal_accounts')
    .select('*').eq('kunde_id', kunde.id).eq('aktiv', true)
    .ilike('email', email).maybeSingle();
  if (!account?.password_hash) return res.status(401).json({ error: 'E-Mail oder Passwort ist falsch.' });

  const { verifyPassword, setSessionCookie } = await import('../portal-auth.js');
  const ok = await verifyPassword(password, account.password_hash);
  if (!ok) return res.status(401).json({ error: 'E-Mail oder Passwort ist falsch.' });

  await supabase.from('talentone_portal_accounts')
    .update({ letzter_login: new Date().toISOString() }).eq('id', account.id);
  setSessionCookie(res, kunde.id, {
    kunde_id: kunde.id, account_id: account.id,
    email: account.email, name: account.name,
  });
  res.json({ ok: true, account: { id: account.id, email: account.email, name: account.name } });
});

// POST /api/public/portal/:token/logout
router.post('/portal/:token/logout', async (req, res) => {
  const kunde = await loadKundeByPortalToken(req.params.token);
  if (!kunde) return res.status(404).json({ error: 'Link ungültig.' });
  const { clearSessionCookie } = await import('../portal-auth.js');
  clearSessionCookie(res, kunde.id);
  res.json({ ok: true });
});

// POST /api/public/portal/:token/passwort-setzen
//   body: { einladungs_token, password }
router.post('/portal/:token/passwort-setzen', async (req, res) => {
  const kunde = await loadKundeByPortalToken(req.params.token);
  if (!kunde) return res.status(404).json({ error: 'Link ungültig.' });
  const einladung = String(req.body?.einladungs_token || '').trim();
  const password = String(req.body?.password || '');
  if (!einladung || password.length < 8) {
    return res.status(400).json({ error: 'Einladungs-Token fehlt oder Passwort zu kurz (min. 8 Zeichen).' });
  }
  const { data: account } = await supabase.from('talentone_portal_accounts')
    .select('*').eq('kunde_id', kunde.id).eq('einladungs_token', einladung).maybeSingle();
  if (!account) return res.status(404).json({ error: 'Einladungs-Link ist ungültig oder wurde bereits verwendet.' });

  const { hashPassword, setSessionCookie } = await import('../portal-auth.js');
  const hash = await hashPassword(password);
  const now = new Date().toISOString();
  await supabase.from('talentone_portal_accounts').update({
    password_hash: hash,
    passwort_gesetzt_at: now,
    letzter_login: now,
    einladungs_token: null,  // verbrauchen, damit der Link nicht wiederverwendet werden kann
  }).eq('id', account.id);

  setSessionCookie(res, kunde.id, {
    kunde_id: kunde.id, account_id: account.id,
    email: account.email, name: account.name,
  });
  res.json({ ok: true, account: { id: account.id, email: account.email, name: account.name } });
});

// GET /api/public/portal/:token/whoami — Session-Info (fuer Frontend-Reload)
router.get('/portal/:token/whoami', async (req, res) => {
  const kunde = await loadKundeByPortalToken(req.params.token);
  if (!kunde) return res.status(404).json({ error: 'Link ungültig.' });
  if (kunde.portal_zugang !== 'account') return res.json({ mode: 'link' });

  // Mitarbeiter-Bypass: gueltiger Supabase-Bearer-Token durchreichen als "staff"
  const auth = req.headers?.authorization || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const { data } = await supabase.auth.getUser(auth.slice(7));
      if (data?.user) {
        return res.json({ mode: 'account', signed_in: true, staff: true,
          account: { email: data.user.email, name: data.user.user_metadata?.name || null } });
      }
    } catch {}
  }

  const { readSessionCookie } = await import('../portal-auth.js');
  const s = readSessionCookie(req, kunde.id);
  const annahme = s ? await getAnnahme(kunde.id) : null;
  res.json({
    mode: 'account', signed_in: !!s,
    account: s ? { email: s.email, name: s.name } : null,
    avv_akzeptiert: !!annahme,
  });
});

/* ── AVV (Auftragsverarbeitungsvertrag) — Public per portal_token ── */

// GET /api/public/avv/:token — AVV-Info + Annahme-Status
router.get('/avv/:token', async (req, res) => {
  const kunde = await loadKundeByPortalToken(req.params.token);
  if (!kunde) return res.status(404).json({ error: 'Link ungültig.' });
  const version = await getAktuelleVersion(kunde.agentur);
  const annahme = await getAnnahme(kunde.id);
  // Bereits akzeptiert -> exakt die akzeptierte Fassung zeigen; sonst die
  // personalisierte aktuelle Fassung (Fallback: generischer Master).
  const pdfUrl = annahme?.pdf_url || (await getPersonalizedAvvPdf(kunde.id)).url || version?.pdf_url || null;
  res.json({
    firmenname: kunde.firmenname,
    agentur: kunde.agentur,
    ansprechpartner: kunde.ansprechpartner,
    anrede_form: kunde.anrede_form,
    anrede_titel: kunde.anrede_titel,
    nachname: kunde.nachname,
    version: version?.version || null,
    pdf_url: pdfUrl,
    akzeptiert: !!annahme,
    akzeptiert_am: annahme?.akzeptiert_am || null,
    akzeptiert_von: annahme?.akzeptiert_von || null,
  });
});

// POST /api/public/avv/:token/akzeptieren  body: { name, email? }
router.post('/avv/:token/akzeptieren', async (req, res) => {
  const kunde = await loadKundeByPortalToken(req.params.token);
  if (!kunde) return res.status(404).json({ error: 'Link ungültig.' });
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Bitte Ihren Namen eingeben.' });
  try {
    const r = await protokolliereAnnahme({
      kunde, akzeptiert_von: name,
      akzeptiert_email: req.body?.email || kunde.email, req,
    });
    res.json({ ok: true, version: r.version.version, ersteAnnahme: r.ersteAnnahme });
  } catch (e) {
    console.error('[avv/akzeptieren]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/public/portal/:token — komplettes Dashboard
router.get('/portal/:token', async (req, res) => {
  try {
    const kunde = await loadKundeByPortalToken(req.params.token);
    if (!kunde) return res.status(404).json({ error: 'Link ungültig oder abgelaufen.' });
    const gate = await requirePortalAccess(kunde, req);
    if (!gate.ok) return res.status(401).json({ error: gate.error, mode: 'account' });

    const { data: jobs = [] } = await supabase.from('talentone_jobs')
      .select('id, stelle, region, projekttyp, neukunden_daten, pipeline_stufen, anfragen_felder, anfragen_token, bewerbungen_token, created_at, vorqualifizierung, vorqualifizierung_felder, wichtige_kriterien')
      .eq('kunde_id', kunde.id)
      .order('created_at', { ascending: true });

    const jobIds = jobs.map(j => j.id);
    const [anfragenRes, bewerbungenRes, creativesRes, adcopiesRes, funnelsRes] = await Promise.all([
      jobIds.length
        ? supabase.from('talentone_anfragen').select('*').in('job_id', jobIds).order('created_at', { ascending: false })
        : { data: [] },
      jobIds.length
        ? supabase.from('talentone_bewerbungen').select('*').in('job_id', jobIds).order('created_at', { ascending: false })
        : { data: [] },
      jobIds.length
        ? supabase.from('talentone_creatives')
            .select('id, job_id, format, typ, bild_url, bild_ohne_logo_url, created_at, archiviert')
            .in('job_id', jobIds)
            .neq('archiviert', true)
            .order('created_at', { ascending: false })
        : { data: [] },
      jobIds.length
        ? supabase.from('talentone_adcopies').select('*').in('job_id', jobIds)
        : { data: [] },
      jobIds.length
        ? supabase.from('talentone_funnels').select('*').in('job_id', jobIds).order('created_at', { ascending: false })
        : { data: [] },
    ]);

    // Vorqualifizierungs-Werte der Bewerbungen (fuer die Vorqual-Spalten im Portal)
    const bewIds = (bewerbungenRes.data || []).map(b => b.id);
    const vorqualWerteByBew = {};
    const kontaktByBew = {};  // bewerbung_id -> { kontaktversuche, erreicht_am }
    if (bewIds.length) {
      const { data: notizen = [] } = await supabase.from('talentone_bewerber_notizen')
        .select('bewerbung_id, vorqualifizierung_werte, anrufversuche').in('bewerbung_id', bewIds);
      for (const n of notizen) {
        vorqualWerteByBew[n.bewerbung_id] = n.vorqualifizierung_werte || {};
        const av = Array.isArray(n.anrufversuche) ? n.anrufversuche : [];
        kontaktByBew[n.bewerbung_id] = {
          kontaktversuche: av.filter(a => a?.datum).map(a => ({ datum: a.datum, erreicht: a.ergebnis === 'erreicht' })),
          erreicht_am: av.find(a => a?.datum && a.ergebnis === 'erreicht')?.datum || null,
        };
      }
    }

    // Kommentare zu allen Anfragen bulk-laden
    const anfragen = anfragenRes.data || [];
    const anfrageIds = anfragen.map(a => a.id);
    const kommentareByAnfrage = {};
    if (anfrageIds.length) {
      const { data: komm = [] } = await supabase.from('talentone_anfragen_kommentare')
        .select('*').in('anfrage_id', anfrageIds).order('created_at', { ascending: true });
      for (const k of komm) (kommentareByAnfrage[k.anfrage_id] ||= []).push(k);
    }

    // Pro Job den Funnel-URL bauen (extern > intern-veroeffentlicht)
    const funnelUrlByJob = {};
    for (const f of (funnelsRes.data || [])) {
      if (funnelUrlByJob[f.job_id]) continue;
      const url = (f.extern && f.extern_url) ? f.extern_url
                : (f.veroeffentlicht ? `${getPublicBaseUrl(kunde.agentur)}/f/${f.id}` : null);
      if (url) funnelUrlByJob[f.job_id] = url;
    }

    // Pipeline-Stufen normalisieren
    const jobsOut = jobs.map(j => {
      let pipeline = Array.isArray(j.pipeline_stufen) && j.pipeline_stufen.length
        ? j.pipeline_stufen : DEFAULT_PIPELINE;
      pipeline = [...pipeline].sort((a, b) => (a.reihenfolge || 0) - (b.reihenfolge || 0));
      return {
        id: j.id, stelle: j.stelle, region: j.region,
        projekttyp: j.projekttyp,
        neukunden_daten: j.neukunden_daten,
        pipeline_stufen: pipeline,
        anfragen_felder: Array.isArray(j.anfragen_felder) ? j.anfragen_felder : null,
        funnel_url: funnelUrlByJob[j.id] || null,
        anfragen_token: j.anfragen_token,
        bewerbungen_token: j.bewerbungen_token,
        vorqualifizierung: !!j.vorqualifizierung,
        wichtige_kriterien: normalizeKriterien(j.wichtige_kriterien),
        // Befuellte Vorqual-Felder + wichtige Kriterien (immer) — gleiche
        // Spaltenlogik wie in der Public-Bewerberliste.
        vorqual_spalten: kundenVorqualSpalten({
          felder: effektiveVorqualFelder(j),
          werte: (bewerbungenRes.data || []).filter(b => b.job_id === j.id)
            .map(b => vorqualWerteByBew[b.id] || {}),
          kriterien: normalizeKriterien(j.wichtige_kriterien),
        }),
      };
    });

    const anfragenOut = anfragen.map(a => ({
      ...a, kommentare: kommentareByAnfrage[a.id] || [],
    }));

    // AVV-Status: für echte Kunden-Accounts (nicht Staff-Bypass) erzwingen wir
    // die Annahme vor dem Portal-Zugang. Der Public-Token für die AVV-Seite ist
    // der portal_token (= :token).
    const istStaff = !!gate.session?.staff;
    const avvAngenommen = await getAnnahme(kunde.id);
    const avvVersion = avvAngenommen ? null : await getAktuelleVersion(kunde.agentur);
    // Noch nicht akzeptiert -> personalisierte aktuelle Fassung; sonst die akzeptierte.
    const avvPdfUrl = avvAngenommen?.pdf_url
      || (avvVersion ? (await getPersonalizedAvvPdf(kunde.id)).url || avvVersion.pdf_url : null);

    res.json({
      kunde: {
        id: kunde.id, firmenname: kunde.firmenname, ansprechpartner: kunde.ansprechpartner,
        email: kunde.email, agentur: kunde.agentur || 'nowagwirth',
        logo_url: kunde.logo_url, farben: kunde.farben,
        anrede_form: kunde.anrede_form, anrede_titel: kunde.anrede_titel, nachname: kunde.nachname,
      },
      jobs: jobsOut,
      anfragen: anfragenOut,
      bewerbungen: (bewerbungenRes.data || []).map(b => ({ ...b, vorqualifizierung_werte: vorqualWerteByBew[b.id] || {}, ...(kontaktByBew[b.id] || { kontaktversuche: [], erreicht_am: null }) })),
      creatives: creativesRes.data || [],
      adcopies: adcopiesRes.data || [],
      avv: {
        erforderlich: kunde.portal_zugang === 'account' && !istStaff && !avvAngenommen,
        akzeptiert: !!avvAngenommen,
        pdf_url: avvPdfUrl,
        version: avvAngenommen?.version || avvVersion?.version || null,
      },
    });
  } catch (err) {
    console.error('[portal/get]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/public/portal/:token/anfrage/:id  body: { status?, notizen?, zustaendiger? }
router.patch('/portal/:token/anfrage/:id', async (req, res) => {
  const kunde = await loadKundeByPortalToken(req.params.token);
  if (!kunde) return res.status(404).json({ error: 'Link ungültig.' });
  { const g = await requirePortalAccess(kunde, req); if (!g.ok) return res.status(401).json({ error: g.error, mode: 'account' }); }
  // Anfrage muss zu einem Job des Kunden gehoeren
  const { data: anfrage } = await supabase.from('talentone_anfragen')
    .select('id, job_id').eq('id', req.params.id).maybeSingle();
  if (!anfrage) return res.status(404).json({ error: 'Anfrage nicht gefunden.' });
  const { data: job } = await supabase.from('talentone_jobs')
    .select('kunde_id').eq('id', anfrage.job_id).maybeSingle();
  if (!job || job.kunde_id !== kunde.id) return res.status(403).json({ error: 'Anfrage gehört nicht zu diesem Portal.' });

  const patch = {};
  if (req.body?.status !== undefined) patch.status = String(req.body.status);
  if (req.body?.notizen !== undefined) patch.notizen = req.body.notizen == null ? null : String(req.body.notizen);
  if (req.body?.name !== undefined) patch.name = req.body.name == null ? null : String(req.body.name);
  if (req.body?.email !== undefined) patch.email = req.body.email == null ? null : String(req.body.email);
  if (req.body?.telefon !== undefined) patch.telefon = req.body.telefon == null ? null : String(req.body.telefon);

  // Beliebige daten-Felder aktualisieren: entweder gezielt (body.daten_patch) oder Zustaendiger.
  const datenPatch = req.body?.daten_patch && typeof req.body.daten_patch === 'object' ? req.body.daten_patch : null;
  const wantsZustaendiger = req.body?.zustaendiger !== undefined;
  if (datenPatch || wantsZustaendiger) {
    const { data: current } = await supabase.from('talentone_anfragen')
      .select('daten').eq('id', anfrage.id).maybeSingle();
    const daten = { ...(current?.daten || {}) };
    if (datenPatch) {
      for (const [k, v] of Object.entries(datenPatch)) {
        const key = String(k).trim();
        if (!key) continue;
        if (v === null || v === '__delete__') delete daten[key];
        else daten[key] = typeof v === 'string' ? v : String(v);
      }
    }
    if (wantsZustaendiger) daten.zustaendiger = req.body.zustaendiger || null;
    patch.daten = daten;
  }
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('talentone_anfragen')
    .update(patch).eq('id', anfrage.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ anfrage: data });
});

// POST /api/public/portal/:token/anfrage/:id/kommentar  body: { text, autor? }
router.post('/portal/:token/anfrage/:id/kommentar', async (req, res) => {
  const kunde = await loadKundeByPortalToken(req.params.token);
  if (!kunde) return res.status(404).json({ error: 'Link ungültig.' });
  { const g = await requirePortalAccess(kunde, req); if (!g.ok) return res.status(401).json({ error: g.error, mode: 'account' }); }
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Text fehlt.' });
  const { data: anfrage } = await supabase.from('talentone_anfragen')
    .select('id, job_id').eq('id', req.params.id).maybeSingle();
  if (!anfrage) return res.status(404).json({ error: 'Anfrage nicht gefunden.' });
  const { data: job } = await supabase.from('talentone_jobs')
    .select('kunde_id').eq('id', anfrage.job_id).maybeSingle();
  if (!job || job.kunde_id !== kunde.id) return res.status(403).json({ error: 'Anfrage gehört nicht zu diesem Portal.' });

  const autor = String(req.body?.autor || kunde.firmenname || 'Kunde').slice(0, 120);
  const { data, error } = await supabase.from('talentone_anfragen_kommentare')
    .insert({ anfrage_id: anfrage.id, autor, text, quelle: 'portal' })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ kommentar: data });
});

// PUT /api/public/portal/:token/pipeline/:jobId  body: { stufen: [...] }
router.put('/portal/:token/pipeline/:jobId', async (req, res) => {
  const kunde = await loadKundeByPortalToken(req.params.token);
  if (!kunde) return res.status(404).json({ error: 'Link ungültig.' });
  { const g = await requirePortalAccess(kunde, req); if (!g.ok) return res.status(401).json({ error: g.error, mode: 'account' }); }
  const { data: job } = await supabase.from('talentone_jobs')
    .select('id, kunde_id').eq('id', req.params.jobId).maybeSingle();
  if (!job || job.kunde_id !== kunde.id) return res.status(403).json({ error: 'Job gehört nicht zu diesem Portal.' });
  const stufen = Array.isArray(req.body?.stufen) ? req.body.stufen : null;
  if (!stufen || !stufen.length) return res.status(400).json({ error: 'stufen fehlt.' });
  // Normalisieren: id/name Pflicht
  const normalized = stufen.map((s, i) => ({
    id: String(s.id || `stufe_${i + 1}`).slice(0, 60),
    name: String(s.name || 'Neue Stufe').slice(0, 60),
    farbe: String(s.farbe || '#6b7280').slice(0, 20),
    reihenfolge: Number.isFinite(+s.reihenfolge) ? +s.reihenfolge : (i + 1) * 10,
  }));
  const { data, error } = await supabase.from('talentone_jobs')
    .update({ pipeline_stufen: normalized })
    .eq('id', job.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ job: data });
});

// POST /api/public/portal/:token/creative/:id/ueberarbeitung
//    body: { text }  — Kunde wuenscht Ueberarbeitung eines Creatives.
router.post('/portal/:token/creative/:id/ueberarbeitung', async (req, res) => {
  const kunde = await loadKundeByPortalToken(req.params.token);
  if (!kunde) return res.status(404).json({ error: 'Link ungültig.' });
  { const g = await requirePortalAccess(kunde, req); if (!g.ok) return res.status(401).json({ error: g.error, mode: 'account' }); }
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Text fehlt.' });

  const { data: creative } = await supabase.from('talentone_creatives')
    .select('id, job_id, format').eq('id', req.params.id).maybeSingle();
  if (!creative) return res.status(404).json({ error: 'Creative nicht gefunden.' });
  const { data: job } = await supabase.from('talentone_jobs')
    .select('id, kunde_id').eq('id', creative.job_id).maybeSingle();
  if (!job || job.kunde_id !== kunde.id) return res.status(403).json({ error: 'Creative gehört nicht zu diesem Portal.' });

  // Aktuelle Runde ermitteln + aenderungen-Status setzen. Analog zum
  // Public-Review-Endpoint, aber ueber Portal-Weg.
  const { data: existingReview } = await supabase.from('talentone_reviews')
    .select('id, runde, kommentare').eq('job_id', job.id)
    .order('runde', { ascending: false }).limit(1).maybeSingle();
  const key = `creative_${creative.id}`;
  const mergedKommentare = { ...(existingReview?.kommentare || {}), [key]: text };
  const runde = existingReview?.runde || 1;

  let saved;
  if (existingReview) {
    const { data, error } = await supabase.from('talentone_reviews')
      .update({ status: 'aenderungen', kommentare: mergedKommentare, updated_at: new Date().toISOString() })
      .eq('id', existingReview.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    saved = data;
  } else {
    // Braucht ein review_token — sicherstellen
    let token = job.review_token;
    if (!token) {
      const { randomUUID } = await import('node:crypto');
      token = randomUUID();
      await supabase.from('talentone_jobs').update({ review_token: token }).eq('id', job.id);
    }
    const { data, error } = await supabase.from('talentone_reviews')
      .insert({ job_id: job.id, token, status: 'aenderungen', runde, kommentare: mergedKommentare })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    saved = data;
  }

  // Kanban-Sync + Team-Benachrichtigung analog Review-Endpoint (best-effort)
  (async () => {
    try {
      const [{ data: kundeFull }, { data: creatives = [] }, { data: adcopies = [] }] = await Promise.all([
        supabase.from('talentone_kunden').select('*').eq('id', kunde.id).maybeSingle(),
        supabase.from('talentone_creatives').select('id, bild_url, format, typ').eq('job_id', job.id).neq('archiviert', true),
        supabase.from('talentone_adcopies').select('id, stil, text').eq('job_id', job.id),
      ]);
      const jobUrl = `${getPublicBaseUrl('talentone')}/kunden/${kunde.id}/jobs/${job.id}/export`;
      await sendReviewBenachrichtigung({
        kunde: kundeFull, job, status: 'aenderungen',
        kommentare: mergedKommentare, jobUrl, creatives, adcopies, snapshot: {},
      });
      await logFeedbackToProjekt({
        kunde: kundeFull, job, status: 'aenderungen',
        kommentare: mergedKommentare, creatives, adcopies,
      });
    } catch (err) { console.warn('[portal/ueberarbeitung sync]', err.message); }
  })();

  res.json({ ok: true, review: saved });
});


/* PATCH /api/public/portal/:token/job/:jobId/kriterien
   Der Kunde pflegt "Das ist uns wichtig" selbst. Invariante wie intern:
   jedes Kriterium referenziert genau ein Vorqual-Feld (Neuland legt eins an).
   Loest interne Benachrichtigung + Projekt-Kommentar aus. */
router.patch('/portal/:token/job/:jobId/kriterien', async (req, res) => {
  try {
    const kunde = await loadKundeByPortalToken(req.params.token);
    if (!kunde) return res.status(404).json({ error: 'Link ungültig oder abgelaufen.' });
    const gate = await requirePortalAccess(kunde, req);
    if (!gate.ok) return res.status(401).json({ error: gate.error, mode: 'account' });

    const { data: job } = await supabase.from('talentone_jobs')
      .select('id, stelle, kunde_id, vorqualifizierung, vorqualifizierung_felder, wichtige_kriterien')
      .eq('id', req.params.jobId).maybeSingle();
    if (!job || job.kunde_id !== kunde.id) {
      return res.status(404).json({ error: 'Stelle nicht gefunden.' });
    }

    const vorher = normalizeKriterien(job.wichtige_kriterien);
    const sync = syncKriterienMitFeldern({
      kriterien: req.body?.kriterien,
      felder: effektiveVorqualFelder(job),
    });

    const { data: updated, error } = await supabase.from('talentone_jobs')
      .update({ wichtige_kriterien: sync.kriterien, vorqualifizierung_felder: sync.felder })
      .eq('id', job.id).select('id, wichtige_kriterien, vorqualifizierung_felder').single();
    if (error) return res.status(500).json({ error: error.message });

    // Intern benachrichtigen (best-effort — nie den Kunden blockieren)
    (async () => {
      try {
        const { sendKriterienGeaendertNotiz } = await import('../mail.js');
        await sendKriterienGeaendertNotiz({
          kunde, job, vorher, nachher: sync.kriterien,
          geaendert_von: gate.session?.email || kunde.ansprechpartner || 'Kunde',
        });
      } catch (e) { console.warn('[portal/kriterien mail]', e.message); }

      try {
        const { data: projekt } = await supabase.from('talentone_projekte')
          .select('id').eq('kunde_id', kunde.id)
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (projekt) {
          const liste = sync.kriterien
            .map(k => `${k.pflicht ? '❗ ' : ''}${k.kriterium}${k.anforderung ? ` — ${k.anforderung}` : ''}`)
            .join(' · ') || '(keine)';
          await supabase.from('talentone_kommentare').insert({
            projekt_id: projekt.id,
            autor: 'Kunde (Portal)',
            text: `⭐ Prüf-Kriterien angepasst für „${job.stelle || 'Stelle'}": ${liste}`,
          });
        }
      } catch (e) { console.warn('[portal/kriterien kommentar]', e.message); }
    })().catch(e => console.warn('[portal/kriterien bg]', e.message));

    res.json({ kriterien: updated.wichtige_kriterien, felder: updated.vorqualifizierung_felder });
  } catch (err) {
    console.error('[portal/kriterien]', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
