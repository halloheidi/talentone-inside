import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { supabase } from '../supabase.js';
import {
  streamCreativesZip, streamAdCopiesPdf,
  generateAnschreibensVorschlag, sendEntwurfsMail,
} from '../exports.js';
import { sendReaktivierungsMail, sendKampagneLiveMail, sendKampagnePauseMail, sendEntwurfReminder, sendTerminEinladung } from '../mail.js';
import { TERMINE, getTerminMeta } from '../termine.js';
import { logReaktivierung, notifyKunde } from '../close.js';
import { getPublicBaseUrl, getBranding } from '../branding.js';

const router = Router();

// Stellt sicher dass der Job einen review_token hat. Gibt ihn zurück.
async function ensureReviewToken(jobId, existing) {
  if (existing) return existing;
  const token = randomUUID();
  await supabase.from('talentone_jobs').update({ review_token: token }).eq('id', jobId);
  return token;
}

async function loadFullJob(jobId) {
  const { data: job, error: jE } = await supabase
    .from('talentone_jobs').select('*').eq('id', jobId).single();
  if (jE || !job) throw new Error('Job nicht gefunden.');
  const { data: kunde } = await supabase
    .from('talentone_kunden').select('*').eq('id', job.kunde_id).single();
  const { data: creatives = [] } = await supabase
    .from('talentone_creatives').select('*').eq('job_id', jobId).order('created_at', { ascending: false });
  const { data: adcopies = [] } = await supabase
    .from('talentone_adcopies').select('*').eq('job_id', jobId);
  const { data: funnel } = await supabase
    .from('talentone_funnels').select('*').eq('job_id', jobId).order('created_at', { ascending: false }).limit(1).maybeSingle();
  return { job, kunde, creatives, adcopies, funnel };
}

function filterByIds(list, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return list;
  const set = new Set(ids);
  return list.filter(x => set.has(x.id));
}

/* GET /api/jobs/:id/export — Übersichts-Daten für den Export-Tab */
router.get('/jobs/:id/export', async (req, res) => {
  try {
    const data = await loadFullJob(req.params.id);
    const baseUrl = getPublicBaseUrl(data.kunde?.agentur);
    const funnelUrl = !data.funnel?.id ? null
      : (data.funnel.extern && data.funnel.extern_url) ? data.funnel.extern_url
      : `${baseUrl}/f/${data.funnel.id}`;
    res.json({ ...data, funnel_url: funnelUrl });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

/* POST /api/jobs/:id/export/zip  body: { creative_ids?: [] } — streamt ZIP */
router.post('/jobs/:id/export/zip', async (req, res) => {
  try {
    const { job, kunde, creatives } = await loadFullJob(req.params.id);
    const selected = filterByIds(creatives, req.body?.creative_ids);
    if (selected.length === 0) return res.status(400).json({ error: 'Keine Creatives ausgewählt.' });
    await streamCreativesZip(res, { job, kunde, creatives: selected });
  } catch (err) {
    console.error('[export/zip]', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

/* POST /api/jobs/:id/export/pdf  body: { adcopy_ids?: [] } — streamt PDF */
router.post('/jobs/:id/export/pdf', async (req, res) => {
  try {
    const { job, kunde, adcopies } = await loadFullJob(req.params.id);
    const selected = filterByIds(adcopies, req.body?.adcopy_ids);
    if (selected.length === 0) return res.status(400).json({ error: 'Keine Ad-Copies ausgewählt.' });
    await streamAdCopiesPdf(res, { job, kunde, adcopies: selected });
  } catch (err) {
    console.error('[export/pdf]', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

/* POST /api/jobs/:id/export/anschreiben — Claude-Vorschlag */
router.post('/jobs/:id/export/anschreiben', async (req, res) => {
  try {
    const { job, kunde } = await loadFullJob(req.params.id);
    const text = await generateAnschreibensVorschlag(job, kunde);
    res.json({ text });
  } catch (err) {
    console.error('[export/anschreiben]', err.message);
    res.status(503).json({ error: err.message });
  }
});

/* POST /api/jobs/:id/export/email
   body: { to, betreff, anschreiben, creative_ids, adcopy_ids, include_funnel }
   Automatik: wenn zur Zeit des Versands bereits eine Review mit
   status='aenderungen' existiert, wird dieser Versand als „Runde N+1"
   markiert — eine neue leere Review-Row angelegt, Betreff/Body-Präfix,
   Versand-Historie mit typ='entwurf_runde_N', und das verknüpfte Projekt
   springt von „feedbackschleife" zurück auf „warte_auf_go" + Auto-
   Kommentar. */
router.post('/jobs/:id/export/email', async (req, res) => {
  const { to, betreff, anschreiben, creative_ids, adcopy_ids, include_funnel } = req.body || {};
  if (!to?.trim()) return res.status(400).json({ error: 'Empfänger-Mail fehlt.' });

  try {
    const { job, kunde, creatives, adcopies, funnel } = await loadFullJob(req.params.id);
    const baseUrl = getPublicBaseUrl(kunde?.agentur);
    const selCreatives = filterByIds(creatives, creative_ids);
    const selAdcopies = filterByIds(adcopies, adcopy_ids);
    const funnelUrl = !include_funnel || !funnel?.id ? null
      : (funnel.extern && funnel.extern_url) ? funnel.extern_url
      : `${baseUrl}/f/${funnel.id}`;
    const sheetUrl = include_funnel && funnel?.extern_sheet_url ? funnel.extern_sheet_url : null;

    // Review-Token sicherstellen + URL bauen
    const reviewToken = await ensureReviewToken(job.id, job.review_token);
    const reviewUrl = `${baseUrl}/review/${reviewToken}`;

    // Runden-Erkennung: gibt es bereits eine Review mit „aenderungen"?
    // Wenn ja, ist DIESER Versand die Antwort auf das Kunden-Feedback → neue
    // Runde. Sonst: normaler Runde-1-Versand.
    const { data: latestReview } = await supabase.from('talentone_reviews')
      .select('id, runde, status')
      .eq('job_id', job.id)
      .order('runde', { ascending: false }).limit(1).maybeSingle();
    // Neue Runde wird geoeffnet, sobald die letzte Review bereits eine
    // Reaktion des Kunden hat (aenderungen ODER freigegeben) — beim erneuten
    // Versand soll der Kunde immer eine frische, offene Runde sehen und
    // wieder kommentieren koennen. Wenn latestReview.status noch offen ist,
    // bleiben wir in derselben Runde.
    const abgeschlossenerStatus = new Set(['aenderungen', 'freigegeben']);
    const istNeueRunde = !!(latestReview && abgeschlossenerStatus.has(latestReview.status));
    const neueRundeNr = istNeueRunde ? (Number(latestReview.runde || 1) + 1) : (Number(latestReview?.runde) || 1);

    // Bei neuer Runde: leere Review-Row anlegen, damit der Kunde beim
    // Öffnen der Review-URL direkt eine frische Runde ohne Kommentare sieht.
    if (istNeueRunde) {
      await supabase.from('talentone_reviews').insert({
        job_id: job.id, token: reviewToken,
        status: null, kommentare: null, kommentare_snapshot: null,
        runde: neueRundeNr,
      });
    }

    const rundePrefix = istNeueRunde ? `[Runde ${neueRundeNr}] ` : '';
    const finalBetreff = istNeueRunde
      ? `Deine überarbeiteten Entwürfe — Runde ${neueRundeNr}`
      : (betreff || null);
    const finalAnschreiben = istNeueRunde
      ? `Danke für dein Feedback! Wir haben die Entwürfe überarbeitet — schau sie dir an:\n\n${anschreiben || ''}`.trim()
      : anschreiben;

    await sendEntwurfsMail({
      to: to.trim(),
      betreff: finalBetreff, anschreiben: finalAnschreiben,
      job, kunde,
      creatives: selCreatives, adcopies: selAdcopies,
      funnelUrl, sheetUrl, reviewUrl,
    });

    // Historie speichern (mit Runden-Marker)
    const { error: insErr } = await supabase.from('talentone_versand').insert({
      job_id: job.id,
      empfaenger: to.trim(),
      betreff: (rundePrefix + (finalBetreff || '')).trim() || null,
      gesendet_von: req.user?.email || null,
      typ: `entwurf_runde_${neueRundeNr}`,
      inhalte: {
        creative_ids: selCreatives.map(c => c.id),
        adcopy_ids: selAdcopies.map(a => a.id),
        funnel_url: funnelUrl,
        anschreiben: finalAnschreiben,
        runde: neueRundeNr,
      },
    });
    if (insErr) console.warn('[export/email] Historie-Insert:', insErr.message);

    // Close-Note (best-effort)
    notifyKunde(kunde, `📤 Entwürfe (Runde ${neueRundeNr}) an Kunden gesendet — ${selCreatives.length} Creative(s), ${selAdcopies.length} Ad Copy(s) · ${new Date().toLocaleDateString('de-DE')}`)
      .catch(err => console.warn('[export/email close-note]', err.message));

    // Bei neuer Runde: Projekt-Status auf 'warte_auf_go' + Auto-Kommentar
    if (istNeueRunde && kunde?.id) {
      try {
        const { data: projekt } = await supabase.from('talentone_projekte')
          .select('id, status').eq('kunde_id', kunde.id)
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (projekt) {
          await supabase.from('talentone_projekte').update({
            status: 'warte_auf_go',
            updated_at: new Date().toISOString(),
          }).eq('id', projekt.id);
          const dateDe = new Date().toLocaleDateString('de-DE');
          await supabase.from('talentone_kommentare').insert({
            projekt_id: projekt.id,
            autor: req.user?.email || 'System',
            text: `📤 Überarbeitete Entwürfe (Runde ${neueRundeNr}) an Kunden gesendet am ${dateDe}`,
            quelle: 'system',
          });
        }
      } catch (err) { console.warn('[export/email] Runde-N-Projekt-Sync:', err.message); }
    }

    res.json({ ok: true, runde: neueRundeNr, ist_neue_runde: istNeueRunde });
  } catch (err) {
    console.error('[export/email]', err.message);
    res.status(503).json({ error: err.message });
  }
});

/* POST /api/jobs/:id/export/reaktivierung
   body: { to, customText, creative_ids?, create_close_task?, ansprechpartner? } */
router.post('/jobs/:id/export/reaktivierung', async (req, res) => {
  const { to, customText, creative_ids, create_close_task = true, ansprechpartner } = req.body || {};
  if (!to?.trim()) return res.status(400).json({ error: 'Empfänger-Mail fehlt.' });

  try {
    const { job, kunde, creatives } = await loadFullJob(req.params.id);
    const brand = getBranding(kunde?.agentur);
    const selCreatives = filterByIds(creatives, creative_ids);
    const calLink = brand.calReaktivierungUrl || brand.calBeratungsUrl;

    await sendReaktivierungsMail({
      to: to.trim(),
      kunde,
      job,
      ansprechpartner: ansprechpartner || kunde?.ansprechpartner,
      customText,
      creatives: selCreatives,
      calLink,
    });

    // Close-Task (best-effort, blockt niemals)
    let closeResult = null;
    if (create_close_task) {
      closeResult = await logReaktivierung({
        leadIdOrEmail: kunde?.close_lead_id || kunde?.email || to.trim(),
        kundenname: kunde?.firmenname,
        stelle: job?.stelle,
      });
    }

    // Historie speichern
    const { error: insErr } = await supabase.from('talentone_versand').insert({
      job_id: job.id,
      empfaenger: to.trim(),
      betreff: `Reaktivierung: Frische KI-Creatives für ${job.stelle || 'Stelle'}`,
      gesendet_von: req.user?.email || null,
      typ: 'reaktivierung',
      inhalte: {
        creative_ids: selCreatives.map(c => c.id),
        customText: customText || null,
        cal_link: calLink,
        close: closeResult,
      },
    });
    if (insErr) console.warn('[export/reaktivierung] Historie-Insert:', insErr.message);

    res.json({ ok: true, close: closeResult });
  } catch (err) {
    console.error('[export/reaktivierung]', err.message);
    res.status(503).json({ error: err.message });
  }
});

/* GET /api/jobs/:id/export/versand — Historie */
router.get('/jobs/:id/export/versand', async (req, res) => {
  const { data, error } = await supabase
    .from('talentone_versand')
    .select('*').eq('job_id', req.params.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ versand: data });
});

/* GET /api/jobs/:id/export/review — neueste Review-Antwort + alle Runden.
   `review` ist die aktuelle (höchste runde) — das Frontend nutzt sie für den
   Status-Chip. `runden` ist die absteigend sortierte Liste aller
   abgeschlossenen Runden — Grundlage für die Timeline im Export-Tab. */
router.get('/jobs/:id/export/review', async (req, res) => {
  const { data, error } = await supabase
    .from('talentone_reviews')
    .select('*').eq('job_id', req.params.id)
    .order('runde', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  const runden = data || [];
  res.json({ review: runden[0] || null, runden });
});

/* POST /api/jobs/:id/export/kampagne-live
   body: { to?, customText?, set_status_live? }
   Mail an Kunden "🚀 Kampagne ist live!" + setzt das verknüpfte Projekt
   automatisch auf Status 'live' (außer set_status_live = false).
   Speichert in talentone_versand mit typ='kampagne_live', damit das
   Frontend einen "Bereits gemeldet"-Hinweis zeigen kann. */
router.post('/jobs/:id/export/kampagne-live', async (req, res) => {
  const { to, customText, set_status_live = true } = req.body || {};
  try {
    const { job, kunde } = await loadFullJob(req.params.id);
    const recipient = (to || kunde?.email || '').trim();
    if (!recipient) return res.status(400).json({ error: 'Kunden-E-Mail fehlt.' });

    const baseUrl = getPublicBaseUrl(kunde?.agentur);
    const bewerbungenUrl = job.bewerbungen_token
      ? `${baseUrl}/bewerbungen/${job.bewerbungen_token}`
      : null;

    await sendKampagneLiveMail({
      to: recipient,
      kunde,
      job,
      ansprechpartner: kunde?.ansprechpartner,
      customText,
      bewerbungenUrl,
    });

    // Versand-Historie
    const { error: insErr } = await supabase.from('talentone_versand').insert({
      job_id: job.id,
      empfaenger: recipient,
      betreff: '🚀 Deine Kampagne ist live!',
      gesendet_von: req.user?.email || null,
      typ: 'kampagne_live',
      inhalte: { bewerbungenUrl, customText: customText || null },
    });
    if (insErr) console.warn('[kampagne-live] Versand-Insert:', insErr.message);

    // Close-Note (best-effort)
    notifyKunde(kunde, `🚀 Kampagne live gemeldet am ${new Date().toLocaleDateString('de-DE')}${job?.stelle ? ` — Stelle: ${job.stelle}` : ''}`)
      .catch(err => console.warn('[kampagne-live close-note]', err.message));

    // Projekt automatisch auf 'live' setzen (best-effort). Zusätzlich:
    // start_phase1 = heute, ende_phase1 = heute + 30 Tage — der Live-Termin
    // ist der Anker, ab dem Phase 1 offiziell zählt.
    if (set_status_live && kunde?.id) {
      try {
        const { data: projekt } = await supabase
          .from('talentone_projekte').select('id,status,start_phase1,ende_phase1').eq('kunde_id', kunde.id)
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (projekt) {
          const today   = new Date();
          const in30    = new Date(today.getTime() + 30 * 86400000);
          const iso = d => d.toISOString().slice(0, 10);
          const patch = { updated_at: new Date().toISOString() };
          if (projekt.status !== 'live') patch.status = 'live';
          if (!projekt.start_phase1)     patch.start_phase1 = iso(today);
          if (!projekt.ende_phase1)      patch.ende_phase1  = iso(in30);
          if (Object.keys(patch).length > 1) {
            await supabase.from('talentone_projekte').update(patch).eq('id', projekt.id);
            console.log(`[kampagne-live] Projekt ${projekt.id.slice(0,8)} → status=live, phase1=${patch.start_phase1 || 'unverändert'}–${patch.ende_phase1 || 'unverändert'}`);
          }
        }
      } catch (err) { console.warn('[kampagne-live] Status-Update:', err.message); }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[kampagne-live]', err.message);
    res.status(503).json({ error: err.message });
  }
});

/* POST /api/jobs/:id/export/kampagne-pause  body: { to?, customText? }
   Meldet dem Kunden „Kampagne aufgrund technischer Probleme pausiert" (Du-Form).
   Setzt am ersten Projekt des Kunden status='pausiert' + pausiert_seit=heute.
   Schreibt einen automatischen Kommentar ins Projekt: „⏸️ Pausen-Mail an Kunden
   gesendet am {Datum} (technische Probleme)". */
router.post('/jobs/:id/export/kampagne-pause', async (req, res) => {
  const { to, customText } = req.body || {};
  try {
    const { job, kunde } = await loadFullJob(req.params.id);
    const recipient = (to || kunde?.email || '').trim();
    if (!recipient) return res.status(400).json({ error: 'Kunden-E-Mail fehlt.' });

    await sendKampagnePauseMail({
      to: recipient,
      kunde,
      ansprechpartner: kunde?.ansprechpartner,
      customText,
    });

    // Versand-Historie
    await supabase.from('talentone_versand').insert({
      job_id: job.id,
      empfaenger: recipient,
      betreff: '⏸ Deine Kampagne ist kurz pausiert',
      gesendet_von: req.user?.email || null,
      typ: 'kampagne_pause',
      inhalte: { customText: customText || null },
    });

    // Close-Note (best-effort)
    notifyKunde(kunde, `⏸️ Kampagne pausiert (technische Probleme) — Mail an Kunden am ${new Date().toLocaleDateString('de-DE')}`)
      .catch(err => console.warn('[kampagne-pause close-note]', err.message));

    // Projekt: status=pausiert, pausiert_seit=heute + Kommentar
    let projektId = null;
    if (kunde?.id) {
      try {
        const { data: projekt } = await supabase
          .from('talentone_projekte').select('id').eq('kunde_id', kunde.id)
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (projekt) {
          projektId = projekt.id;
          const iso = new Date().toISOString().slice(0, 10);
          await supabase.from('talentone_projekte').update({
            status: 'pausiert',
            pausiert_seit: iso,
            updated_at: new Date().toISOString(),
          }).eq('id', projekt.id);
          const dateDe = new Date().toLocaleDateString('de-DE');
          await supabase.from('talentone_kommentare').insert({
            projekt_id: projekt.id,
            autor:      req.user?.email || 'System',
            text:       `⏸️ Pausen-Mail an Kunden gesendet am ${dateDe} (technische Probleme)`,
            quelle:     'system',
          });
        }
      } catch (err) { console.warn('[kampagne-pause] Projekt-Update:', err.message); }
    }

    res.json({ ok: true, projekt_id: projektId });
  } catch (err) {
    console.error('[kampagne-pause]', err.message);
    res.status(503).json({ error: err.message });
  }
});

/* POST /api/jobs/:id/export/entwurf-reminder  body: { to?, customText? }
   Manueller Reminder an den Kunden, wenn er noch nicht auf die letzten
   Entwuerfe reagiert hat. Setzt keinen Status, aendert nichts am Review —
   loggt nur in talentone_versand (typ=entwurf_reminder). */
router.post('/jobs/:id/export/entwurf-reminder', async (req, res) => {
  const { to, customText } = req.body || {};
  try {
    const { job, kunde } = await loadFullJob(req.params.id);
    const recipient = (to || kunde?.email || '').trim();
    if (!recipient) return res.status(400).json({ error: 'Kunden-E-Mail fehlt.' });

    // Review-Token sicherstellen (fuer den Freigabe-Button)
    const token = await ensureReviewToken(job.id, job.review_token);
    const reviewUrl = `${getPublicBaseUrl(kunde?.agentur)}/review/${token}`;

    await sendEntwurfReminder({
      to: recipient,
      ansprechpartner: kunde?.ansprechpartner,
      reviewUrl, customText,
      agentur: kunde?.agentur,
    });

    // Versand-Historie
    await supabase.from('talentone_versand').insert({
      job_id: job.id,
      empfaenger: recipient,
      betreff: 'Kurze Erinnerung: deine Entwürfe warten auf Freigabe',
      gesendet_von: req.user?.email || null,
      typ: 'entwurf_reminder',
      inhalte: { customText: customText || null, review_url: reviewUrl },
    });

    // Close-Note (best-effort)
    notifyKunde(kunde, `🔔 Entwurfs-Reminder an Kunden gesendet am ${new Date().toLocaleDateString('de-DE')}`)
      .catch(err => console.warn('[entwurf-reminder close-note]', err.message));

    res.json({ ok: true });
  } catch (err) {
    console.error('[entwurf-reminder]', err.message);
    res.status(503).json({ error: err.message });
  }
});

/* POST /api/jobs/:id/export/review-manuell
   body: { status: 'freigegeben'|'aenderungen', notiz?: string }
   Team setzt das Review-Ergebnis eigenhaendig, weil der Kunde anderweitig
   geantwortet hat (Telefon/Mail). Verhindert weitere 7-Tage-Reminder,
   loest denselben Projekt-Sync + Auto-Kommentar aus wie ein normales
   Public-Review-Ergebnis. */
router.post('/jobs/:id/export/review-manuell', async (req, res) => {
  const { status, notiz } = req.body || {};
  if (!['freigegeben', 'aenderungen'].includes(status)) {
    return res.status(400).json({ error: 'status muss "freigegeben" oder "aenderungen" sein.' });
  }
  try {
    const { data: job } = await supabase.from('talentone_jobs')
      .select('id, kunde_id, stelle').eq('id', req.params.id).maybeSingle();
    if (!job) return res.status(404).json({ error: 'Job nicht gefunden.' });

    const { data: kunde } = await supabase.from('talentone_kunden')
      .select('id, firmenname, agentur, close_lead_id, email').eq('id', job.kunde_id).maybeSingle();

    // Aktuelle (hoechste) Runde suchen — analog Public-Review-Endpoint
    const { data: existing } = await supabase
      .from('talentone_reviews').select('id, runde').eq('job_id', job.id)
      .order('runde', { ascending: false }).limit(1).maybeSingle();

    const patch = {
      status,
      manuell_beantwortet: true,
      manuell_notiz: notiz?.toString().trim() || null,
      reminder_intern_gesendet_at: null, // Reset: neue Runde bekaeme neue Reminder
    };

    let savedReview;
    if (existing) {
      const { data, error } = await supabase.from('talentone_reviews')
        .update(patch).eq('id', existing.id).select().single();
      if (error) return res.status(500).json({ error: error.message });
      savedReview = data;
    } else {
      const { data, error } = await supabase.from('talentone_reviews')
        .insert({ job_id: job.id, token: randomUUID(), ...patch }).select().single();
      if (error) return res.status(500).json({ error: error.message });
      savedReview = data;
    }

    // Projekt-Kommentar + Status-Update (best-effort)
    (async () => {
      try {
        const { data: projekt } = await supabase
          .from('talentone_projekte').select('id, status')
          .eq('kunde_id', kunde?.id)
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (!projekt) return;

        const datum = new Date().toLocaleDateString('de-DE');
        const label = status === 'freigegeben' ? 'Freigabe' : 'Änderungswünsche';
        const notizPart = notiz ? `\n\nNotiz: ${notiz}` : '';
        await supabase.from('talentone_kommentare').insert({
          projekt_id: projekt.id,
          autor: 'Kundenfeedback (manuell)',
          text: `✓ Kunde hat manuell geantwortet: ${label} — ${datum}${notizPart}`,
          quelle: 'review',
        });

        // Kanban-Automatik: Freigabe → 'go', Aenderungen → 'feedbackschleife'
        let newStatus = null;
        if (status === 'freigegeben' && projekt.status !== 'live') newStatus = 'go';
        if (status === 'aenderungen') newStatus = 'feedbackschleife';
        if (newStatus && newStatus !== projekt.status) {
          await supabase.from('talentone_projekte')
            .update({ status: newStatus, updated_at: new Date().toISOString() })
            .eq('id', projekt.id);
        }

        // Close-Note (best-effort)
        if (kunde) {
          const noteText = status === 'freigegeben'
            ? `✅ Kunde hat Entwürfe freigegeben (manuell — anderweitig geantwortet) am ${datum}${notiz ? ` · Notiz: ${notiz}` : ''}`
            : `📝 Kunde hat Änderungswünsche gesendet (manuell — anderweitig geantwortet) am ${datum}${notiz ? ` · Notiz: ${notiz}` : ''}`;
          notifyKunde(kunde, noteText).catch(err => console.warn('[review-manuell close-note]', err.message));
        }
      } catch (err) { console.warn('[review-manuell sync]', err.message); }
    })();

    res.json({ ok: true, review: savedReview });
  } catch (err) {
    console.error('[review-manuell]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* GET /api/termine/config — Frontend-Katalog aller Termin-Arten */
router.get('/termine/config', (req, res) => {
  const cfg = {};
  for (const [key, t] of Object.entries(TERMINE)) {
    cfg[key] = {
      label: t.label, subject: t.subject, intro: t.intro,
      personen: [
        ...(t.daniel   ? [{ key: 'daniel',   label: 'Daniel' }] : []),
        ...(t.johannes ? [{ key: 'johannes', label: 'Johannes' }] : []),
      ],
    };
  }
  res.json({ termine: cfg });
});

/* POST /api/jobs/:id/export/termin-einladung
   body: { terminKey, personKey, to?, subject?, customText? } */
router.post('/jobs/:id/export/termin-einladung', async (req, res) => {
  const { terminKey, personKey, to, subject, customText } = req.body || {};
  const meta = getTerminMeta(terminKey, personKey);
  if (!meta) return res.status(400).json({ error: 'Ungültige Termin-Kombination.' });

  try {
    const { job, kunde } = await loadFullJob(req.params.id);
    const recipient = (to || kunde?.email || '').trim();
    if (!recipient) return res.status(400).json({ error: 'Empfänger-E-Mail fehlt.' });

    await sendTerminEinladung({
      to: recipient,
      ansprechpartner: kunde?.ansprechpartner,
      agentur: kunde?.agentur,
      subject: subject || meta.subject,
      calLink: meta.url,
      customText,
      personLabel: meta.personLabel,
    });

    await supabase.from('talentone_versand').insert({
      job_id: job.id,
      empfaenger: recipient,
      betreff: subject || meta.subject,
      gesendet_von: req.user?.email || null,
      typ: 'termin_einladung',
      inhalte: {
        terminKey, personKey, cal_link: meta.url,
        label: meta.label, personLabel: meta.personLabel,
        customText: customText || null,
      },
    });

    // Projekt-Kommentar (best-effort)
    if (kunde?.id) {
      (async () => {
        try {
          const { data: projekt } = await supabase.from('talentone_projekte')
            .select('id').eq('kunde_id', kunde.id)
            .order('created_at', { ascending: false }).limit(1).maybeSingle();
          if (projekt) {
            await supabase.from('talentone_kommentare').insert({
              projekt_id: projekt.id,
              autor: req.user?.email || 'System',
              text: `📅 Termin-Einladung (${meta.label}, bei ${meta.personLabel}) an Kunden gesendet`,
              quelle: 'system',
            });
          }
        } catch (err) { console.warn('[termin-einladung projekt-kommentar]', err.message); }
      })();
    }

    // Close-Note (best-effort)
    notifyKunde(kunde, `📅 Termin-Einladung (${meta.label}) an Kunden gesendet am ${new Date().toLocaleDateString('de-DE')}`)
      .catch(err => console.warn('[termin-einladung close-note]', err.message));

    res.json({ ok: true });
  } catch (err) {
    console.error('[termin-einladung]', err.message);
    res.status(503).json({ error: err.message });
  }
});

/* POST /api/kunden/:id/termin-einladung — analog fuer den KundeDetail-Weg
   (kein Job-Kontext noetig). Loggt ohne job_id. */
router.post('/kunden/:id/termin-einladung', async (req, res) => {
  const { terminKey, personKey, to, subject, customText } = req.body || {};
  const meta = getTerminMeta(terminKey, personKey);
  if (!meta) return res.status(400).json({ error: 'Ungültige Termin-Kombination.' });

  try {
    const { data: kunde } = await supabase.from('talentone_kunden')
      .select('*').eq('id', req.params.id).maybeSingle();
    if (!kunde) return res.status(404).json({ error: 'Kunde nicht gefunden.' });
    const recipient = (to || kunde.email || '').trim();
    if (!recipient) return res.status(400).json({ error: 'Empfänger-E-Mail fehlt.' });

    await sendTerminEinladung({
      to: recipient,
      ansprechpartner: kunde.ansprechpartner,
      agentur: kunde.agentur,
      subject: subject || meta.subject,
      calLink: meta.url,
      customText,
      personLabel: meta.personLabel,
    });

    // Projekt-Kommentar + Versand-Historie (falls es ein Projekt gibt) — best-effort.
    // Historie am erstbesten Job, damit sie im Export-Tab sichtbar wird.
    const { data: firstJob } = await supabase.from('talentone_jobs')
      .select('id').eq('kunde_id', kunde.id).order('created_at', { ascending: true }).limit(1).maybeSingle();
    if (firstJob) {
      await supabase.from('talentone_versand').insert({
        job_id: firstJob.id,
        empfaenger: recipient,
        betreff: subject || meta.subject,
        gesendet_von: req.user?.email || null,
        typ: 'termin_einladung',
        inhalte: {
          terminKey, personKey, cal_link: meta.url,
          label: meta.label, personLabel: meta.personLabel,
          customText: customText || null,
        },
      });
    }
    (async () => {
      try {
        const { data: projekt } = await supabase.from('talentone_projekte')
          .select('id').eq('kunde_id', kunde.id)
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (projekt) {
          await supabase.from('talentone_kommentare').insert({
            projekt_id: projekt.id,
            autor: req.user?.email || 'System',
            text: `📅 Termin-Einladung (${meta.label}, bei ${meta.personLabel}) an Kunden gesendet`,
            quelle: 'system',
          });
        }
      } catch (err) { console.warn('[kunde/termin-einladung projekt-kommentar]', err.message); }
    })();

    notifyKunde(kunde, `📅 Termin-Einladung (${meta.label}) an Kunden gesendet am ${new Date().toLocaleDateString('de-DE')}`)
      .catch(err => console.warn('[kunde/termin-einladung close-note]', err.message));

    res.json({ ok: true });
  } catch (err) {
    console.error('[kunde/termin-einladung]', err.message);
    res.status(503).json({ error: err.message });
  }
});

/* POST /api/jobs/:id/export/review-reset
   Team-Aktion: Kunde hat versehentlich freigegeben oder moechte doch
   noch kommentieren. Legt eine frische offene Runde an (runde = max+1),
   ohne dass wir neu senden muessen. Der Kunde sieht beim naechsten
   Oeffnen der Review-URL wieder das Formular. */
router.post('/jobs/:id/export/review-reset', async (req, res) => {
  try {
    const { data: job } = await supabase.from('talentone_jobs')
      .select('id, kunde_id, review_token').eq('id', req.params.id).maybeSingle();
    if (!job) return res.status(404).json({ error: 'Job nicht gefunden.' });

    // Aktueller Review-Stand
    const { data: latest } = await supabase.from('talentone_reviews')
      .select('id, runde, status').eq('job_id', job.id)
      .order('runde', { ascending: false }).limit(1).maybeSingle();
    const neueRundeNr = (Number(latest?.runde) || 0) + 1;

    // review_token sicherstellen
    let token = job.review_token;
    if (!token) {
      const { randomUUID } = await import('node:crypto');
      token = randomUUID();
      await supabase.from('talentone_jobs').update({ review_token: token }).eq('id', job.id);
    }

    // Neue offene Runde einfuegen
    const { data: created, error } = await supabase.from('talentone_reviews').insert({
      job_id: job.id, token, status: null,
      kommentare: null, kommentare_snapshot: null,
      runde: neueRundeNr,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });

    // Kanban-Projekt zurueck auf 'feedbackschleife' setzen, falls es
    // auf 'go' stand — damit der Wechsel sichtbar ist.
    (async () => {
      try {
        const { data: kunde } = await supabase.from('talentone_kunden')
          .select('id, close_lead_id, email').eq('id', job.kunde_id).maybeSingle();
        const { data: projekt } = await supabase.from('talentone_projekte')
          .select('id, status').eq('kunde_id', job.kunde_id)
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (projekt && projekt.status === 'go') {
          await supabase.from('talentone_projekte')
            .update({ status: 'feedbackschleife', updated_at: new Date().toISOString() })
            .eq('id', projekt.id);
        }
        if (projekt) {
          await supabase.from('talentone_kommentare').insert({
            projekt_id: projekt.id,
            autor: req.user?.email || 'System',
            text: `🔓 Kommentierung wieder freigeschaltet (Runde ${neueRundeNr}) — Kunde kann erneut Feedback geben.`,
            quelle: 'system',
          });
        }
        if (kunde) {
          notifyKunde(kunde, `🔓 Kommentierung wieder freigeschaltet (Runde ${neueRundeNr}) am ${new Date().toLocaleDateString('de-DE')}`)
            .catch(err => console.warn('[review-reset close-note]', err.message));
        }
      } catch (err) { console.warn('[review-reset sync]', err.message); }
    })();

    res.json({ ok: true, review: created });
  } catch (err) {
    console.error('[review-reset]', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
