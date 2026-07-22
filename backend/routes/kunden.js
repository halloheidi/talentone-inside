import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { supabase } from '../supabase.js';
import { extractFromUrl, extractFromFile, toKunde, toJob } from '../extractor.js';
import { uploadBuffer, deleteFromBucket, safeFilenameStem } from '../storage.js';
import { normalizeImageForStorage } from '../imageops.js';
import { sendUploadAnfrage, sendFormularEinladung, sendAvvAnfrage } from '../mail.js';
import { notifyKunde } from '../close.js';
import { extractColorsFromUrl, extractColorsFromImageBuffer } from '../colors.js';
import { findVerwaisteAngeboteForKunde } from '../offer-linking.js';

const router = Router();

/* GET /api/kunden/suche?q= — schlanke Kundensuche (Firmenname/E-Mail).
   MUSS vor GET /:id stehen. */
router.get('/suche', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ kunden: [] });
  const pattern = `%${q.replace(/[%_]/g, m => '\\' + m)}%`;
  const { data } = await supabase.from('talentone_kunden')
    .select('id, firmenname, email, agentur, archiviert')
    .or(`firmenname.ilike.${pattern},email.ilike.${pattern}`)
    .eq('archiviert', false)
    .order('firmenname', { ascending: true }).limit(20);
  res.json({ kunden: data || [] });
});

import { getPublicBaseUrl } from '../branding.js';

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
const PROJEKTE_STATI = [
  'vorbereitung', 'kickoff_vereinbart', 'onboarding', 'golive_vereinbart',
  'warte_auf_go', 'feedbackschleife', 'go',
  'live', 'pausiert', 'hold', 'abgeschlossen',
];

router.post('/quick-create', async (req, res) => {
  const {
    mode, logo, agentur, projekt_status, projektart, verantwortlich,
    // Migration 025: neue Projekt-Flags direkt beim Anlegen
    projektdauer, fotograf_noetig, zahlung_aufgeteilt, garantie, garantie_details,
    // Migration 027
    kickoff_termin,
  } = req.body || {};
  const finalAgentur = agentur === 'nowagwirth' ? 'nowagwirth' : 'talentone';
  let kundeData = { agentur: finalAgentur };
  let jobData = {};
  let urlForColors = null;

  try {
    if (mode === 'manual') {
      const { kunde = {}, job = {} } = req.body;
      if (!kunde.firmenname?.trim()) return res.status(400).json({ error: 'Firmenname ist Pflicht.' });
      if (!job.stelle?.trim()) return res.status(400).json({ error: 'Stelle ist Pflicht.' });
      if (kunde.close_lead_id && !/^lead_/.test(kunde.close_lead_id)) {
        return res.status(400).json({ error: 'close_lead_id muss mit lead_ beginnen.' });
      }
      kundeData = {
        ...kundeData,
        firmenname: kunde.firmenname.trim(),
        ansprechpartner: kunde.ansprechpartner || null,
        email: kunde.email || null,
        telefon: kunde.telefon || null,
        branche: kunde.branche || null,
        notizen: kunde.notizen || null,
        close_lead_id: kunde.close_lead_id || null,
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
      kundeData = { ...toKunde(extracted), agentur: finalAgentur };
      jobData = toJob(extracted, 'url', url);
      if (!kundeData.firmenname) return res.status(422).json({ error: 'Firmenname konnte nicht ermittelt werden.', extracted });
      if (!jobData.stelle) jobData.stelle = 'Unbenannte Stelle';
    } else if (mode === 'file') {
      const { fileData, fileType } = req.body;
      const extracted = await extractFromFile(fileData, fileType);
      kundeData = { ...toKunde(extracted), agentur: finalAgentur };
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
      .insert({
        ...jobData,
        kunde_id: kunde.id,
        vorqualifizierung: kunde.agentur === 'nowagwirth',
      })
      .select()
      .single();
    if (jErr) {
      // Kunde wieder löschen, damit kein Halb-Zustand bleibt
      await supabase.from('talentone_kunden').delete().eq('id', kunde.id);
      return res.status(500).json({ error: `Job anlegen: ${jErr.message}` });
    }

    // Projekt in Kanban anlegen (Kanban/Liste-Übersicht)
    const status = PROJEKTE_STATI.includes(projekt_status) ? projekt_status : 'vorbereitung';
    const projektName = job.stelle || kunde.firmenname || 'Neues Projekt';
    await supabase.from('talentone_projekte').insert({
      projekt: projektName,
      kunde: kunde.firmenname,
      kunde_id: kunde.id,
      status,
      projektart: projektart || (finalAgentur === 'talentone' ? 'TalentOne - Mitarbeitergewinnung' : 'Mitarbeitergewinnung'),
      projektdauer: projektdauer || null,
      agentur: finalAgentur,
      fotograf_noetig: finalAgentur === 'nowagwirth' ? !!fotograf_noetig : false,
      zahlung_aufgeteilt: !!zahlung_aufgeteilt,
      garantie: !!garantie,
      garantie_details: garantie && garantie_details ? String(garantie_details).trim() : null,
      kickoff_termin: kickoff_termin || null,
      gesuchte_positionen: job.stelle || null,
      standorte: job.region || null,
      verantwortlich: verantwortlich || null,
      email: kunde.email || null,
      close_lead_id: kunde.close_lead_id || null,  // Punkt 8: Kunde ist primär, Projekt sync
      updated_at: new Date().toISOString(),
    });

    // Antwort sofort raus — Logo + Farb-Extraktion sind best-effort und blockieren nicht.
    res.status(201).json({ kunde, job });

    // Hintergrund: Logo hochladen + Farben extrahieren (Logo-Farben haben Priorität, sonst URL)
    (async () => {
      let logoUrl = null;
      let logoBuffer = null;

      if (logo?.fileData) {
        try {
          const norm = await normalizeImageForStorage(Buffer.from(logo.fileData, 'base64'), { kind: 'logo', label: logo.fileName || 'Logo' });
          logoBuffer = norm.buffer;
          const stem = safeFilenameStem(logo.fileName || 'logo');
          const path = `${kunde.id}/${Date.now()}-${stem}.${norm.ext}`;
          logoUrl = await uploadBuffer({
            bucket: 'talentone-logos', path, buffer: logoBuffer,
            contentType: norm.contentType,
          });
          await supabase.from('talentone_kunden').update({ logo_url: logoUrl, logo_uploaded_at: new Date().toISOString() }).eq('id', kunde.id);
          console.log(`[quick-create-bg] Logo gesetzt für ${kunde.id.slice(0, 8)}`);
          try {
            const { prepareAndSaveTransparentLogo } = await import('../logo.js');
            await prepareAndSaveTransparentLogo(kunde.id, logoBuffer, { supabase, uploadBuffer, deleteFromBucket });
          } catch (err) { console.warn('[quick-create-bg] transparent-Logo:', err.message); }
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
  const includeArchived = req.query.include_archived === '1';
  const onlyArchived    = req.query.only_archived    === '1';
  let q = supabase.from('talentone_kunden').select('*').order('created_at', { ascending: false });
  if (onlyArchived) q = q.eq('archiviert', true);
  else if (!includeArchived) q = q.eq('archiviert', false);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // AVV-Status: aktive Kunden ohne Annahme markieren (dezentes ⚠️ in der Liste).
  const ids = (data || []).map(k => k.id);
  let mitAnnahme = new Set();
  if (ids.length) {
    const { data: ann } = await supabase.from('talentone_avv_annahmen')
      .select('kunde_id').in('kunde_id', ids);
    mitAnnahme = new Set((ann || []).map(a => a.kunde_id));
  }
  const kunden = (data || []).map(k => ({
    ...k,
    avv_offen: k.status === 'aktiv' && !mitAnnahme.has(k.id),
  }));
  res.json({ kunden });
});

/* GET /api/kunden/naechste-schritte?ids=a,b,c — Badge-Daten fuer die Liste.
   Wenn ids leer: alle nicht-archivierten. */
router.get('/naechste-schritte', async (req, res) => {
  try {
    let ids = String(req.query.ids || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!ids.length) {
      const { data } = await supabase.from('talentone_kunden')
        .select('id').eq('archiviert', false);
      ids = (data || []).map(k => k.id);
    }
    const { ermittleNaechsteSchritte } = await import('../naechste-schritte.js');
    const map = await ermittleNaechsteSchritte(ids);
    res.json({ schritte: map });
  } catch (err) {
    console.error('[naechste-schritte]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* GET /api/kunden/dubletten-check?q=Firmenname
   Liefert ähnliche Kunden + Projekte für die Dubletten-Warnung beim Anlegen.
   Trifft auf ilike-Match (case-insensitive, Teilstring) — bewusst großzügig. */
router.get('/dubletten-check', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 3) return res.json({ kunden: [], projekte: [] });
  const pattern = `%${q.replace(/[%_]/g, m => '\\' + m)}%`;
  try {
    const [kRes, pRes] = await Promise.all([
      supabase.from('talentone_kunden')
        .select('id,firmenname,email,agentur,created_at')
        .ilike('firmenname', pattern).limit(10),
      supabase.from('talentone_projekte')
        .select('id,projekt,kunde,kunde_id,agentur,status,created_at')
        .ilike('kunde', pattern).limit(10),
    ]);
    res.json({
      kunden: kRes.data || [],
      projekte: pRes.data || [],
    });
  } catch (err) {
    console.error('[dubletten-check]', err.message);
    res.json({ kunden: [], projekte: [] });
  }
});

router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('talentone_kunden')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Kunde nicht gefunden.' });
  // AVV-Status mitliefern (für die Kunden-Detail-Anzeige).
  let avv = null;
  try {
    const { getAnnahme, getAktuelleVersion } = await import('../avv.js');
    const [annahme, aktuelle_version] = await Promise.all([
      getAnnahme(data.id), getAktuelleVersion(data.agentur),
    ]);
    avv = { annahme, aktuelle_version };
  } catch (e) { console.warn('[kunde/detail avv]', e.message); }
  res.json({ kunde: data, avv });
});

/* GET /api/kunden/:id/verwaiste-angebote — verwaiste Angebote (ohne customer_id),
   die per E-Mail/Firmenname zu diesem Kunden passen. Für den Verknüpfungs-Hinweis
   nach dem Anlegen eines Kunden. */
router.get('/:id/verwaiste-angebote', async (req, res) => {
  const { data: kunde } = await supabase.from('talentone_kunden')
    .select('id, firmenname, email').eq('id', req.params.id).maybeSingle();
  if (!kunde) return res.status(404).json({ error: 'Kunde nicht gefunden.' });
  try {
    const angebote = await findVerwaisteAngeboteForKunde(kunde);
    res.json({ angebote });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* GET /api/kunden/:id/activity — chronologische Timeline aus vorhandenen
   Zeitstempeln (Angebote, Rechnungen, Einstellungen, Skip-Log, Budget-
   Historie). Read-only, neueste zuerst. Muss mit Direkt-AB-Rows
   (easybill_document_id=NULL) und Standalone-Rechnungen (offer_id=NULL)
   fehlerfrei umgehen. */
router.get('/:id/activity', async (req, res) => {
  const kundeId = req.params.id;
  try {
    const [offersRes, invoicesRes, hiresRes, skipRes, budgetRes] = await Promise.all([
      supabase.from('talentone_offers')
        .select('id, brand, status, easybill_document_id, easybill_order_document_id, created_at, sent_at, sent_to, accepted_at, declined_at, decline_note, order_sent_at, order_sent_to, first_month_total, monthly_total, campaign_started_at, billing_ended_at')
        .eq('customer_id', kundeId),
      supabase.from('talentone_invoices')
        .select('id, offer_id, invoice_type, source, brand, status, amount_gross, created_at, paid_at, due_date, sent_at, sent_to, label')
        .eq('customer_id', kundeId),
      supabase.from('talentone_hires')
        .select('id, offer_id, hired_at, position, created_at')
        .in('offer_id', (await supabase.from('talentone_offers').select('id').eq('customer_id', kundeId)).data?.map(o => o.id) || ['00000000-0000-0000-0000-000000000000']),
      supabase.from('talentone_billing_skip_log')
        .select('id, offer_id, period_start, reason, created_at')
        .in('offer_id', (await supabase.from('talentone_offers').select('id').eq('customer_id', kundeId)).data?.map(o => o.id) || ['00000000-0000-0000-0000-000000000000']),
      supabase.from('talentone_ad_budget_history')
        .select('id, offer_id, old_amount, new_amount, effective_from, created_at, reason')
        .in('offer_id', (await supabase.from('talentone_offers').select('id').eq('customer_id', kundeId)).data?.map(o => o.id) || ['00000000-0000-0000-0000-000000000000']),
    ]);

    const events = [];
    const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
    const brandLabel = b => b === 'nowag_wirth' ? 'Nowag & Wirth' : 'TalentOne';

    for (const o of offersRes.data || []) {
      const bl = brandLabel(o.brand);
      const isDirect = !o.easybill_document_id && !!o.easybill_order_document_id;
      events.push({ ts: o.created_at, icon: '📝', kind: 'offer_created',
        title: isDirect ? `Direktauftrag angelegt — ${bl}` : `Angebot angelegt — ${bl}`,
        detail: `Monat 1: ${eur.format(Number(o.first_month_total) || 0)}`, offer_id: o.id });
      if (o.sent_at) events.push({ ts: o.sent_at, icon: '📧', kind: 'offer_sent',
        title: `Angebot versandt — ${bl}`, detail: `an ${o.sent_to || '—'}`, offer_id: o.id });
      if (o.accepted_at) events.push({ ts: o.accepted_at, icon: '✅', kind: 'offer_accepted',
        title: isDirect ? `Direktauftrag angenommen — ${bl}` : `Angebot angenommen — ${bl}`, offer_id: o.id });
      if (o.declined_at) events.push({ ts: o.declined_at, icon: '❌', kind: 'offer_declined',
        title: `Angebot abgelehnt — ${bl}`, detail: o.decline_note || null, offer_id: o.id });
      if (o.order_sent_at) events.push({ ts: o.order_sent_at, icon: '📋', kind: 'order_sent',
        title: `Auftragsbestätigung versandt — ${bl}`, detail: `an ${o.order_sent_to || '—'}`, offer_id: o.id });
      if (o.campaign_started_at) events.push({ ts: o.campaign_started_at, icon: '🚀', kind: 'campaign_started',
        title: `Kampagne gestartet — ${bl}`, offer_id: o.id });
      if (o.billing_ended_at) events.push({ ts: o.billing_ended_at, icon: '🏁', kind: 'billing_ended',
        title: `Abrechnung beendet — ${bl}`, offer_id: o.id });
    }

    for (const inv of invoicesRes.data || []) {
      const bl = brandLabel(inv.brand);
      const typLabel = inv.invoice_type === 'ad_budget' && inv.source === 'standalone'
        ? 'Werbekosten-Rechnung (freistehend)'
        : ({ setup: 'Setup-Rechnung', monthly_service: 'Monatsrechnung',
             monthly_combined: 'Monatsrechnung', ad_budget: 'Werbekosten-Rechnung' }[inv.invoice_type] || 'Rechnung');
      events.push({ ts: inv.created_at, icon: '📄', kind: 'invoice_created',
        title: `${typLabel} erzeugt — ${bl}`, detail: `${eur.format(Number(inv.amount_gross) || 0)}${inv.label ? ` · ${inv.label}` : ''}`,
        offer_id: inv.offer_id || null, invoice_id: inv.id });
      if (inv.sent_at) events.push({ ts: inv.sent_at, icon: '📧', kind: 'invoice_sent',
        title: `${typLabel} per Mail versandt`, detail: `an ${inv.sent_to || '—'}`,
        offer_id: inv.offer_id || null, invoice_id: inv.id });
      if (inv.paid_at) events.push({ ts: inv.paid_at, icon: '💰', kind: 'invoice_paid',
        title: `${typLabel} bezahlt`, detail: eur.format(Number(inv.amount_gross) || 0),
        offer_id: inv.offer_id || null, invoice_id: inv.id });
      if (inv.status === 'overdue') events.push({ ts: inv.due_date || inv.created_at, icon: '⚠', kind: 'invoice_overdue',
        title: `${typLabel} überfällig`, detail: `Fällig ${inv.due_date || '—'}`,
        offer_id: inv.offer_id || null, invoice_id: inv.id });
    }

    for (const h of hiresRes.data || []) {
      events.push({ ts: h.hired_at || h.created_at, icon: '🎯', kind: 'hire',
        title: 'Einstellung erfasst', detail: h.position || null, offer_id: h.offer_id });
    }
    for (const s of skipRes.data || []) {
      events.push({ ts: s.created_at, icon: '⏭', kind: 'billing_skip',
        title: 'Servicefreier Monat', detail: `Periode ${s.period_start} · ${s.reason}`, offer_id: s.offer_id });
    }
    for (const b of budgetRes.data || []) {
      events.push({ ts: b.created_at, icon: '💸', kind: 'budget_change',
        title: 'Werbebudget geändert',
        detail: `${eur.format(Number(b.old_amount) || 0)} → ${eur.format(Number(b.new_amount) || 0)} (wirksam ${b.effective_from})${b.reason ? ' · ' + b.reason : ''}`,
        offer_id: b.offer_id });
    }

    // Sortieren neueste zuerst; Ereignisse ohne ts (defensiv) hinten anstellen
    events.sort((a, b) => {
      const ta = a.ts ? new Date(a.ts).getTime() : 0;
      const tb = b.ts ? new Date(b.ts).getTime() : 0;
      return tb - ta;
    });

    res.json({ activity: events });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { firmenname, ansprechpartner, email, telefon, logo_url, branche, notizen, close_lead_id, agentur } = req.body || {};
  if (!firmenname) return res.status(400).json({ error: 'firmenname ist Pflicht.' });
  if (close_lead_id && !/^lead_/.test(close_lead_id)) {
    return res.status(400).json({ error: 'close_lead_id muss mit lead_ beginnen.' });
  }
  const { data, error } = await supabase
    .from('talentone_kunden')
    .insert({ firmenname, ansprechpartner, email, telefon, logo_url, branche, notizen,
              close_lead_id: close_lead_id || null, agentur: agentur || null })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ kunde: data });
});

router.patch('/:id', async (req, res) => {
  const allowed = ['firmenname', 'ansprechpartner', 'email', 'telefon', 'logo_url', 'branche', 'notizen', 'farben', 'website_url', 'agentur',
                   'paypal_enabled', 'campaign_payment_status', 'close_lead_id', 'keine_ki_bilder', 'funnel_stellen_mapping',
                   'anrede_form', 'anrede_titel', 'nachname'];
  const patch = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));

  // Anrede validieren + konsistent halten: Titel gehört nur zur Sie-Form.
  if (patch.anrede_form !== undefined) {
    if (patch.anrede_form !== null && !['du', 'sie'].includes(patch.anrede_form)) {
      return res.status(400).json({ error: 'anrede_form muss "du" oder "sie" sein.' });
    }
    if (patch.anrede_form === 'du') patch.anrede_titel = null;
  }
  if (patch.anrede_titel !== undefined && patch.anrede_titel !== null
      && !['herr', 'frau'].includes(patch.anrede_titel)) {
    return res.status(400).json({ error: 'anrede_titel muss "herr" oder "frau" sein.' });
  }
  if (patch.nachname !== undefined && patch.nachname !== null) {
    patch.nachname = String(patch.nachname).trim() || null;
  }
  if (patch.close_lead_id !== undefined) {
    if (patch.close_lead_id === '' || patch.close_lead_id === null) patch.close_lead_id = null;
    else if (!/^lead_/.test(patch.close_lead_id)) {
      return res.status(400).json({ error: 'close_lead_id muss mit lead_ beginnen.' });
    }
  }
  const { data, error } = await supabase
    .from('talentone_kunden')
    .update(patch)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ kunde: data });
});

/* GET /api/kunden/:id/loeschen-vorschau
   Liefert Zählwerte aller verknüpften Datensätze — Basis für die
   Klartext-Warnung im Bestätigungs-Dialog. */
router.get('/:id/loeschen-vorschau', async (req, res) => {
  const id = req.params.id;
  try {
    const { data: kunde } = await supabase.from('talentone_kunden')
      .select('id, firmenname').eq('id', id).maybeSingle();
    if (!kunde) return res.status(404).json({ error: 'Kunde nicht gefunden.' });

    // Job-IDs sammeln
    const { data: jobs = [] } = await supabase.from('talentone_jobs')
      .select('id').eq('kunde_id', id);
    const jobIds = jobs.map(j => j.id);

    // Für jede abhängige Tabelle: Anzahl
    const countAt = async (table, filterCol, filterVal) => {
      if (Array.isArray(filterVal) && filterVal.length === 0) return 0;
      let q = supabase.from(table).select('id', { count: 'exact', head: true });
      if (Array.isArray(filterVal)) q = q.in(filterCol, filterVal);
      else q = q.eq(filterCol, filterVal);
      const { count } = await q;
      return count || 0;
    };

    const [creatives, bewerbungen, funnels, adcopies, reviews, referenzbilder, versand, zahlungen, anfragen, projekte] = await Promise.all([
      countAt('talentone_creatives', 'job_id', jobIds),
      countAt('talentone_bewerbungen', 'job_id', jobIds),
      countAt('talentone_funnels', 'job_id', jobIds),
      countAt('talentone_adcopies', 'job_id', jobIds),
      countAt('talentone_reviews', 'job_id', jobIds),
      countAt('talentone_referenzbilder', 'kunde_id', id),
      countAt('talentone_versand', 'job_id', jobIds),
      countAt('talentone_zahlungen', 'kunde_id', id),
      countAt('talentone_anfragen', 'job_id', jobIds),
      countAt('talentone_projekte', 'kunde_id', id),
    ]);

    res.json({
      firmenname: kunde.firmenname,
      counts: {
        jobs: jobs.length,
        creatives, bewerbungen, funnels, adcopies, reviews,
        referenzbilder, versand, zahlungen, anfragen,
        projekte, // hint: bleiben erhalten, nur kunde_id genullt
      },
    });
  } catch (err) {
    console.error('[loeschen-vorschau]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* DELETE /api/kunden/:id  body: { firmenname_confirm: string }
   Kaskadierter Delete: entfernt alle abhängigen Daten inkl. Storage-Objekte.
   Sicherheit: der Firmenname muss zur Bestätigung im Body mitgeschickt werden.
   Projekte werden NICHT gelöscht — nur kunde_id genullt (Historie bleibt). */
router.delete('/:id', async (req, res) => {
  const id = req.params.id;
  const { firmenname_confirm } = req.body || {};

  const { data: kunde, error: kErr } = await supabase.from('talentone_kunden')
    .select('id, firmenname, logo_url, logo_transparent_url').eq('id', id).maybeSingle();
  if (kErr) return res.status(500).json({ error: kErr.message });
  if (!kunde) return res.status(404).json({ error: 'Kunde nicht gefunden.' });

  const expected = (kunde.firmenname || '').trim();
  if (!firmenname_confirm || firmenname_confirm.trim() !== expected) {
    return res.status(400).json({
      error: `Bestätigung fehlt oder falsch. Bitte den Firmennamen exakt eintippen: "${expected}"`,
    });
  }

  try {
    const { deleteFromStorage: delCreative } = await import('../imagegen.js');

    // 1. Job-IDs holen (Basis für alle abhängigen Zeilen)
    const { data: jobs = [] } = await supabase.from('talentone_jobs')
      .select('id').eq('kunde_id', id);
    const jobIds = jobs.map(j => j.id);

    // 2. Creatives — Storage-Files sammeln UND anschließend DB-Zeilen löschen
    if (jobIds.length) {
      const { data: creatives = [] } = await supabase.from('talentone_creatives')
        .select('bild_url, bild_ohne_logo_url').in('job_id', jobIds);
      for (const c of creatives) {
        if (c.bild_url) await delCreative(c.bild_url).catch(() => {});
        if (c.bild_ohne_logo_url) await delCreative(c.bild_ohne_logo_url).catch(() => {});
      }
      await supabase.from('talentone_creatives').delete().in('job_id', jobIds);

      // 3. Bewerbungen → bewerber_notizen, bewerber_kundenfeedback, bewerber_spalten_werte
      const { data: bewerbungen = [] } = await supabase.from('talentone_bewerbungen')
        .select('id').in('job_id', jobIds);
      const bewerbungIds = bewerbungen.map(b => b.id);
      if (bewerbungIds.length) {
        await Promise.all([
          supabase.from('talentone_bewerber_notizen').delete().in('bewerbung_id', bewerbungIds),
          supabase.from('talentone_bewerber_kundenfeedback').delete().in('bewerbung_id', bewerbungIds),
          supabase.from('talentone_bewerber_spalten_werte').delete().in('bewerbung_id', bewerbungIds),
        ]);
      }

      // 4. Bewerbungen + bewerber_spalten + funnels + adcopies + reviews + versand + anfragen
      await Promise.all([
        supabase.from('talentone_bewerbungen').delete().in('job_id', jobIds),
        supabase.from('talentone_bewerber_spalten').delete().in('job_id', jobIds),
        supabase.from('talentone_funnels').delete().in('job_id', jobIds),
        supabase.from('talentone_adcopies').delete().in('job_id', jobIds),
        supabase.from('talentone_reviews').delete().in('job_id', jobIds),
        supabase.from('talentone_versand').delete().in('job_id', jobIds),
        supabase.from('talentone_anfragen').delete().in('job_id', jobIds),
        supabase.from('talentone_zahlungen').delete().in('job_id', jobIds),
      ]);
    }

    // 5. Referenzbilder — Storage + DB
    const { data: refbilder = [] } = await supabase.from('talentone_referenzbilder')
      .select('bild_url, typ').eq('kunde_id', id);
    for (const r of refbilder) {
      const bucket = r.typ === 'logo' ? 'talentone-logos' : 'talentone-referenzbilder';
      if (r.bild_url) await deleteFromBucket(bucket, r.bild_url).catch(() => {});
    }
    await supabase.from('talentone_referenzbilder').delete().eq('kunde_id', id);

    // 6. Zahlungen (kunde_id-basiert, falls noch welche ohne job_id existieren)
    await supabase.from('talentone_zahlungen').delete().eq('kunde_id', id);

    // 7. Jobs
    await supabase.from('talentone_jobs').delete().eq('kunde_id', id);

    // 8. Projekte: NICHT löschen — nur kunde_id nullen (Historie bleibt)
    await supabase.from('talentone_projekte')
      .update({ kunde_id: null }).eq('kunde_id', id);

    // 9. Logo-Storage aufräumen
    if (kunde.logo_url) await deleteFromBucket('talentone-logos', kunde.logo_url).catch(() => {});
    if (kunde.logo_transparent_url) await deleteFromBucket('talentone-logos', kunde.logo_transparent_url).catch(() => {});

    // 10. Kunde selbst
    const { error: dErr } = await supabase.from('talentone_kunden').delete().eq('id', id);
    if (dErr) return res.status(500).json({ error: dErr.message });

    console.log(`[kunde-delete] ${expected} (${id.slice(0, 8)}) + ${jobIds.length} Jobs gelöscht.`);
    res.json({ ok: true, deleted_jobs: jobIds.length });
  } catch (err) {
    console.error('[kunde-delete]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* POST /api/kunden/:id/archivieren — Soft-Archiv: verschwindet aus Liste,
   Daten bleiben. body: {} */
router.post('/:id/archivieren', async (req, res) => {
  const { data, error } = await supabase.from('talentone_kunden')
    .update({ archiviert: true, archiviert_am: new Date().toISOString() })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ kunde: data });
});

/* POST /api/kunden/:id/wiederherstellen — Reaktiviert einen archivierten Kunden. */
router.post('/:id/wiederherstellen', async (req, res) => {
  const { data, error } = await supabase.from('talentone_kunden')
    .update({ archiviert: false, archiviert_am: null })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ kunde: data });
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
    const norm = await normalizeImageForStorage(decodeBase64File(fileData), { kind: 'logo', label: fileName });
    const buffer = norm.buffer;
    const stem = safeFilenameStem(fileName);
    const path = `${req.params.id}/${Date.now()}-${stem}.${norm.ext}`;
    const publicUrl = await uploadBuffer({ bucket: 'talentone-logos', path, buffer, contentType: norm.contentType });

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

    // logo_transparent_url synchron auf null: die transparente Version wird
    // nur async/best-effort neu erzeugt. Ohne dieses Null-Setzen zeigt die
    // gespeicherte URL im Zwischenfenster (oder bei Regen-Fehlschlag) noch aufs
    // ALTE Logo — und die Creative-Generierung (ensureTransparentLogo) bevorzugt
    // genau diese URL. So wird garantiert das AKTUELLE Logo kompositiert.
    const update = { logo_url: publicUrl, logo_transparent_url: null, logo_uploaded_at: new Date().toISOString() };
    if (farbenUpdate) update.farben = farbenUpdate;

    const { data: updated, error: uErr } = await supabase
      .from('talentone_kunden')
      .update(update)
      .eq('id', req.params.id)
      .select()
      .single();
    if (uErr) return res.status(500).json({ error: uErr.message });

    // Transparente Version im Hintergrund — blockiert die Response nicht
    (async () => {
      try {
        const { prepareAndSaveTransparentLogo } = await import('../logo.js');
        await prepareAndSaveTransparentLogo(req.params.id, buffer, { supabase, uploadBuffer, deleteFromBucket });
      } catch (err) { console.warn('[logo-upload] transparent:', err.message); }
    })();

    res.status(201).json({ kunde: updated });
  } catch (err) {
    console.error('[logo-upload]', err.message);
    res.status(400).json({ error: err.userMessage || err.message });
  }
});

router.delete('/:id/logo', async (req, res) => {
  const { data: existing } = await supabase
    .from('talentone_kunden').select('logo_url, logo_transparent_url').eq('id', req.params.id).maybeSingle();
  if (existing?.logo_url) await deleteFromBucket('talentone-logos', existing.logo_url);
  if (existing?.logo_transparent_url) await deleteFromBucket('talentone-logos', existing.logo_transparent_url);
  await supabase.from('talentone_kunden')
    .update({ logo_url: null, logo_transparent_url: null }).eq('id', req.params.id);
  res.json({ ok: true });
});

/* POST /api/kunden/:id/logo/reprocess
   Regeneriert die transparente Version des Logos aus dem aktuellen logo_url.
   Für Bestandsdaten und für Fälle, wo die Auto-Prep fehlgeschlagen ist. */
router.post('/:id/logo/reprocess', async (req, res) => {
  const { data: kunde } = await supabase.from('talentone_kunden')
    .select('id, logo_url').eq('id', req.params.id).maybeSingle();
  if (!kunde) return res.status(404).json({ error: 'Kunde nicht gefunden.' });
  if (!kunde.logo_url) return res.status(400).json({ error: 'Kein Logo hinterlegt.' });
  try {
    const { fetchAsBuffer } = await import('../storage.js');
    const { prepareAndSaveTransparentLogo } = await import('../logo.js');
    const { buffer } = await fetchAsBuffer(kunde.logo_url);
    const publicUrl = await prepareAndSaveTransparentLogo(kunde.id, buffer,
      { supabase, uploadBuffer, deleteFromBucket });
    res.json({ ok: true, logo_transparent_url: publicUrl });
  } catch (err) {
    console.error('[logo-reprocess]', err.message);
    res.status(500).json({ error: err.message });
  }
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
    const norm = await normalizeImageForStorage(decodeBase64File(fileData), { kind: 'foto', label: fileName });
    const stem = safeFilenameStem(fileName);
    const path = `${req.params.id}/${Date.now()}-${stem}.${norm.ext}`;
    const publicUrl = await uploadBuffer({ bucket: 'talentone-referenzbilder', path, buffer: norm.buffer, contentType: norm.contentType });

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
    res.status(400).json({ error: err.userMessage || err.message });
  }
});

// POST /api/kunden/referenzbilder/:id/verbessern
// body: { optionen: string[], hintergrund_setting?: string, atmosphaere_setting?: string }
// Rueckgabe: { preview_url, angewendete_optionen } — persistiert NICHT.
router.post('/referenzbilder/:id/verbessern', async (req, res) => {
  try {
    const { generateVerbesserung } = await import('../photo-enhance.js');
    const { preview_url, angewendete_optionen } = await generateVerbesserung({
      referenzbildId: req.params.id,
      optionen: req.body?.optionen,
      hintergrund_setting: req.body?.hintergrund_setting,
      atmosphaere_setting: req.body?.atmosphaere_setting,
    });
    res.json({ preview_url, angewendete_optionen });
  } catch (err) {
    console.error('[referenzbild/verbessern]', err.message);
    const status = /keine_ki_bilder/i.test(err.message) ? 403
                 : /nicht gefunden/i.test(err.message)  ? 404
                 : /mindestens eine/i.test(err.message) ? 400
                 : 500;
    res.status(status).json({ error: err.message });
  }
});

// POST /api/kunden/referenzbilder/:id/verbessern/save
// body: { preview_url, angewendete_optionen }
// Persistiert die generierte Version als neue Referenzbild-Row.
router.post('/referenzbilder/:id/verbessern/save', async (req, res) => {
  try {
    const { saveVerbesserung } = await import('../photo-enhance.js');
    const neu = await saveVerbesserung({
      referenzbildId: req.params.id,
      preview_url: req.body?.preview_url,
      angewendete_optionen: req.body?.angewendete_optionen,
    });
    res.status(201).json({ referenzbild: neu });
  } catch (err) {
    console.error('[referenzbild/verbessern/save]', err.message);
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
  const { email, firmenname, ansprechpartner, customText, agentur, projekttyp, close_lead_id } = req.body || {};
  if (!email?.trim()) return res.status(400).json({ error: 'E-Mail ist Pflicht.' });
  const finalAgentur = agentur === 'nowagwirth' ? 'nowagwirth' : 'talentone';
  const pt = projekttyp === 'neukundengewinnung' ? 'neukundengewinnung' : 'mitarbeitergewinnung';
  if (close_lead_id && !/^lead_/.test(close_lead_id)) {
    return res.status(400).json({ error: 'close_lead_id muss mit lead_ beginnen.' });
  }

  const token = randomUUID();
  const { data: kunde, error: kErr } = await supabase
    .from('talentone_kunden')
    .insert({
      email: email.trim(),
      firmenname: firmenname?.trim() || null,
      ansprechpartner: ansprechpartner?.trim() || null,
      status: 'wartend',
      formular_token: token,
      agentur: finalAgentur,
      close_lead_id: close_lead_id || null,
    })
    .select().single();
  if (kErr) return res.status(500).json({ error: `Kunde anlegen: ${kErr.message}` });

  // Wartender Job (Platzhalter) — damit GET /formular/:token den projekttyp findet
  const { error: jErr } = await supabase
    .from('talentone_jobs')
    .insert({
      kunde_id: kunde.id,
      projekttyp: pt,
      stelle: pt === 'neukundengewinnung' ? '[Produkt-Briefing ausstehend]' : '[Briefing ausstehend]',
      eingabe_methode: 'neu',
      vorqualifizierung: pt === 'mitarbeitergewinnung' && finalAgentur === 'nowagwirth',
      formdata_komplett: { _wartet_auf_briefing: true },
    });
  if (jErr) console.error('[formular-anlegen] Job anlegen:', jErr.message);

  // Projekt in Kanban anlegen — sonst taucht der neue Kunde nirgends auf.
  const { error: pErr } = await supabase.from('talentone_projekte').insert({
    projekt: '[Wartet auf Briefing]',
    kunde: kunde.firmenname || kunde.email,
    kunde_id: kunde.id,
    status: 'vorbereitung',
    agentur: finalAgentur,
    projektart: pt === 'neukundengewinnung' ? 'Neukundengewinnung' :
                (finalAgentur === 'talentone' ? 'TalentOne - Mitarbeitergewinnung' : 'Mitarbeitergewinnung'),
    email: kunde.email || null,
    close_lead_id: kunde.close_lead_id || null,
    updated_at: new Date().toISOString(),
  });
  if (pErr) console.error('[formular-anlegen] Projekt-Insert:', pErr.message);

  const formularUrl = `${getPublicBaseUrl(kunde.agentur)}/formular/${token}`;
  try {
    await sendFormularEinladung({
      kunde,
      to: kunde.email, ansprechpartner: kunde.ansprechpartner,
      formularUrl, customText, agentur: kunde.agentur, projekttyp: pt,
    });
  } catch (err) {
    console.error('[formular-anlegen] Mail:', err.message);
    // Kunde wieder löschen, weil Formular ohne Mail wertlos ist
    await supabase.from('talentone_kunden').delete().eq('id', kunde.id);
    return res.status(503).json({ error: `Mail-Versand fehlgeschlagen: ${err.message}` });
  }
  notifyKunde(kunde, `📋 Onboarding-Formular an Kunden gesendet am ${new Date().toLocaleDateString('de-DE')}`)
    .catch(err => console.warn('[formular-anlegen close-note]', err.message));

  res.status(201).json({ kunde, formularUrl });
});

/* ─────────────────── Upload-Anfrage per Mail ─────────────────── */

// POST /api/kunden/:id/anfrage  body: { customText? } — schickt Mail mit Upload-Link
router.post('/:id/anfrage', async (req, res) => {
  const { customText } = req.body || {};
  const umfang = ['beides', 'logo', 'fotos'].includes(req.body?.umfang) ? req.body.umfang : 'beides';
  const umfangLabel = umfang === 'logo' ? 'Logo-Anfrage'
    : umfang === 'fotos' ? 'Foto-Anfrage'
      : 'Foto- & Logo-Anfrage';
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

  const uploadUrl = `${getPublicBaseUrl(kunde.agentur)}/upload/${token}`;

  try {
    await sendUploadAnfrage({
      to: kunde.email,
      kunde,
      kundenname: kunde.firmenname || 'euer Team',
      ansprechpartner: kunde.ansprechpartner,
      uploadUrl,
      customText,
      agentur: kunde.agentur,
      umfang,
    });
    // Versand-Historie am erstbesten Job protokollieren — damit die
    // naechste-schritte-Logik "Fotos anfragen" auf "Wartet auf Fotos" umschalten
    // kann. Bisher fehlte dieser Eintrag komplett.
    const { data: firstJob } = await supabase.from('talentone_jobs')
      .select('id').eq('kunde_id', kunde.id)
      .order('created_at', { ascending: true }).limit(1).maybeSingle();
    if (firstJob) {
      await supabase.from('talentone_versand').insert({
        job_id: firstJob.id,
        empfaenger: kunde.email,
        betreff: umfangLabel,
        gesendet_von: req.user?.email || null,
        typ: 'anfrage',
        inhalte: { customText: customText || null, upload_url: uploadUrl, umfang },
      });
    }
    notifyKunde(kunde, `📸 ${umfangLabel} an Kunden gesendet am ${new Date().toLocaleDateString('de-DE')}`)
      .catch(err => console.warn('[anfrage close-note]', err.message));
    res.json({ ok: true, uploadUrl });
  } catch (err) {
    console.error('[anfrage]', err.message);
    res.status(503).json({ error: err.message });
  }
});

/* POST /api/kunden/:id/avv-anfrage  body: { to?, text? }
   Schickt eine eigene Mail mit prominentem Button zur Public-AVV-Seite
   (portal_token). Protokolliert: Versand (typ 'avv_anfrage') am neuesten Job +
   Close-Note. Die Annahme selbst laeuft ueber die bestehende Public-Seite und
   protokolliereAnnahme — eine Quelle, vier Tueren. */
router.post('/:id/avv-anfrage', async (req, res) => {
  const { data: kunde, error: kErr } = await supabase
    .from('talentone_kunden').select('*').eq('id', req.params.id).maybeSingle();
  if (kErr || !kunde) return res.status(404).json({ error: 'Kunde nicht gefunden.' });

  const to = (req.body?.to || kunde.email || '').trim();
  if (!to) return res.status(400).json({ error: 'Empfänger-E-Mail fehlt (Kunde hat keine E-Mail).' });

  // Public-AVV-Seite laeuft ueber portal_token — bei Bedarf erzeugen.
  let portalToken = kunde.portal_token;
  if (!portalToken) {
    portalToken = randomUUID();
    const { error: uErr } = await supabase
      .from('talentone_kunden').update({ portal_token: portalToken }).eq('id', kunde.id);
    if (uErr) return res.status(500).json({ error: uErr.message });
  }
  const avvUrl = `${getPublicBaseUrl(kunde.agentur)}/avv/${portalToken}`;

  try {
    await sendAvvAnfrage({ to, kunde, avvUrl, customText: req.body?.text, agentur: kunde.agentur });

    const { data: firstJob } = await supabase.from('talentone_jobs')
      .select('id').eq('kunde_id', kunde.id)
      .order('created_at', { ascending: true }).limit(1).maybeSingle();
    if (firstJob) {
      await supabase.from('talentone_versand').insert({
        job_id: firstJob.id,
        empfaenger: to,
        betreff: 'AVV zur Unterschrift',
        gesendet_von: req.user?.email || null,
        typ: 'avv_anfrage',
        inhalte: { text: req.body?.text || null, avv_url: avvUrl },
      });
    }
    notifyKunde(kunde, `📄 AVV zur Unterschrift an ${to} gesendet am ${new Date().toLocaleDateString('de-DE')}`)
      .catch(err => console.warn('[avv-anfrage close-note]', err.message));

    res.json({ ok: true, avvUrl });
  } catch (err) {
    console.error('[avv-anfrage]', err.message);
    res.status(503).json({ error: err.message });
  }
});

/* ═══════════ Portal-Accounts (echter Login pro Kunde) ═══════════ */

// GET /api/kunden/:id/portal-accounts — Liste (ohne Passwort-Hash)
router.get('/:id/portal-accounts', async (req, res) => {
  const { data, error } = await supabase.from('talentone_portal_accounts')
    .select('id, email, name, einladung_gesendet_at, passwort_gesetzt_at, letzter_login, aktiv, benachrichtige_leads, created_at')
    .eq('kunde_id', req.params.id).order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ accounts: data || [] });
});

// PATCH /api/kunden/:id/portal-accounts/:accId  body: { benachrichtige_leads?, aktiv?, name? }
router.patch('/:id/portal-accounts/:accId', async (req, res) => {
  const patch = {};
  if (req.body?.benachrichtige_leads !== undefined) patch.benachrichtige_leads = !!req.body.benachrichtige_leads;
  if (req.body?.aktiv !== undefined) patch.aktiv = !!req.body.aktiv;
  if (req.body?.name !== undefined) patch.name = req.body.name == null ? null : String(req.body.name).trim() || null;
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Keine änderbaren Felder im Body.' });
  const { data, error } = await supabase.from('talentone_portal_accounts')
    .update(patch).eq('id', req.params.accId).eq('kunde_id', req.params.id)
    .select('id, email, name, aktiv, benachrichtige_leads').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ account: data });
});

// POST /api/kunden/:id/portal-accounts  body: { email, name }
// Legt Account an + generiert Einladungs-Token + schickt Einladungs-Mail.
router.post('/:id/portal-accounts', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const name = String(req.body?.name || '').trim() || null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Gültige E-Mail-Adresse erforderlich.' });
  }
  const { data: kunde } = await supabase.from('talentone_kunden')
    .select('id, firmenname, agentur, portal_token, portal_zugang').eq('id', req.params.id).maybeSingle();
  if (!kunde) return res.status(404).json({ error: 'Kunde nicht gefunden.' });

  const { data: account, error } = await supabase.from('talentone_portal_accounts').insert({
    kunde_id: kunde.id, email, name,
  }).select().single();
  if (error) {
    if (String(error.message || '').includes('duplicate')) {
      return res.status(409).json({ error: 'Für diese E-Mail existiert bereits ein Account.' });
    }
    return res.status(500).json({ error: error.message });
  }

  // Wenn Portal-Zugang noch auf 'link' steht: automatisch auf 'account' umstellen
  if (kunde.portal_zugang !== 'account') {
    await supabase.from('talentone_kunden').update({ portal_zugang: 'account' }).eq('id', kunde.id);
  }

  // Einladungs-Mail — best-effort
  try {
    const { getPublicBaseUrl } = await import('../branding.js');
    const { sendPortalEinladung } = await import('../mail.js');
    const portalUrl = `${getPublicBaseUrl(kunde.agentur)}/portal/${kunde.portal_token}`;
    const setupUrl = `${portalUrl}?einladung=${account.einladungs_token}`;
    await sendPortalEinladung({
      kunde,
      to: email, name, portalUrl, setupUrl,
      kundenname: kunde.firmenname, agentur: kunde.agentur,
    });
    await supabase.from('talentone_portal_accounts')
      .update({ einladung_gesendet_at: new Date().toISOString() }).eq('id', account.id);
  } catch (err) {
    console.warn('[portal-account/create] Mail:', err.message);
  }

  res.status(201).json({
    account: { id: account.id, email: account.email, name: account.name },
  });
});

// POST /api/kunden/:id/portal-accounts/:accId/einladung-neu — Einladung neu senden
router.post('/:id/portal-accounts/:accId/einladung-neu', async (req, res) => {
  const { data: account } = await supabase.from('talentone_portal_accounts')
    .select('*').eq('id', req.params.accId).eq('kunde_id', req.params.id).maybeSingle();
  if (!account) return res.status(404).json({ error: 'Account nicht gefunden.' });
  const { data: kunde } = await supabase.from('talentone_kunden')
    .select('id, firmenname, agentur, portal_token').eq('id', req.params.id).maybeSingle();
  if (!kunde) return res.status(404).json({ error: 'Kunde nicht gefunden.' });

  // Neuen Einladungs-Token generieren + Passwort loeschen (falls schon gesetzt)
  const { randomUUID } = await import('node:crypto');
  const neuerToken = randomUUID();
  await supabase.from('talentone_portal_accounts').update({
    einladungs_token: neuerToken,
    password_hash: null,
    passwort_gesetzt_at: null,
  }).eq('id', account.id);

  try {
    const { getPublicBaseUrl } = await import('../branding.js');
    const { sendPortalEinladung } = await import('../mail.js');
    const portalUrl = `${getPublicBaseUrl(kunde.agentur)}/portal/${kunde.portal_token}`;
    const setupUrl = `${portalUrl}?einladung=${neuerToken}`;
    await sendPortalEinladung({
      kunde,
      to: account.email, name: account.name, portalUrl, setupUrl,
      kundenname: kunde.firmenname, agentur: kunde.agentur,
    });
    await supabase.from('talentone_portal_accounts')
      .update({ einladung_gesendet_at: new Date().toISOString() }).eq('id', account.id);
  } catch (err) {
    return res.status(503).json({ error: `Mail-Versand fehlgeschlagen: ${err.message}` });
  }
  res.json({ ok: true });
});

// DELETE /api/kunden/:id/portal-accounts/:accId
router.delete('/:id/portal-accounts/:accId', async (req, res) => {
  const { error } = await supabase.from('talentone_portal_accounts')
    .delete().eq('id', req.params.accId).eq('kunde_id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// PATCH /api/kunden/:id/portal-zugang  body: { modus: 'link' | 'account' }
router.patch('/:id/portal-zugang', async (req, res) => {
  const modus = String(req.body?.modus || '').trim();
  if (!['link', 'account'].includes(modus)) {
    return res.status(400).json({ error: 'modus muss "link" oder "account" sein.' });
  }
  const { data, error } = await supabase.from('talentone_kunden')
    .update({ portal_zugang: modus }).eq('id', req.params.id)
    .select('id, portal_zugang').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ kunde: data });
});

export default router;
