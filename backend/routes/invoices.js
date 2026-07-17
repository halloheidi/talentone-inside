// Abrechnungs-Routen (Phase 5) — Setup-Rechnung, monatliches Abo,
// Werbebudget, Beenden, Manual-Sync, PDF.

import { Router } from 'express';
import { supabase } from '../supabase.js';
import { anrede, t } from '../anrede.js';
import { getDocumentPdf, ensureFinalized } from '../easybill.js';
import {
  createSetupInvoice,
  createStandaloneAdBudgetInvoice,
  activateMonthlyBilling,
  stopMonthlyBilling,
  reactivateMonthlyBilling,
  updateAdBudget,
  findExistingInvoiceForOffer,
  runMonthlyBillingForOffer,
} from '../invoice-service.js';
import { sendRechnungMail } from '../mail.js';
import { addNote as closeAddNote } from '../close.js';
import { runMonthlyBillingRound, getBillingCronStatus } from '../billing-scheduler.js';
import { runReminderRound, getReminderStatus } from '../billing-reminder.js';
import {
  syncOpenInvoices, evaluateCampaignPaymentStatus, getInvoiceSyncStatus,
} from '../invoice-sync.js';

const router = Router();

/* GET /api/invoices?offer_id=&customer_id=&status= */
router.get('/', async (req, res) => {
  let q = supabase.from('talentone_invoices').select('*').order('created_at', { ascending: false });
  if (req.query.offer_id)    q = q.eq('offer_id', req.query.offer_id);
  if (req.query.customer_id) q = q.eq('customer_id', req.query.customer_id);
  if (req.query.status)      q = q.eq('status', req.query.status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ invoices: data || [] });
});

/* GET /api/invoices/:id */
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase.from('talentone_invoices').select('*').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Rechnung nicht gefunden.' });
  res.json({ invoice: data });
});

/* GET /api/invoices/:id/pdf — Proxy analog zum Offer-PDF */
router.get('/:id/pdf', async (req, res) => {
  try {
    const { data: inv } = await supabase.from('talentone_invoices').select('easybill_document_id, brand').eq('id', req.params.id).maybeSingle();
    if (!inv) return res.status(404).json({ error: 'Rechnung nicht gefunden.' });
    if (!inv.easybill_document_id) return res.status(409).json({ error: 'Rechnung wurde noch nicht in easybill erzeugt.' });
    const buf = await getDocumentPdf(inv.easybill_document_id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Rechnung.pdf"`);
    res.send(buf);
  } catch (err) { res.status(502).json({ error: `easybill: ${err.message}` }); }
});

/* GET /api/invoices/offer/:offerId/dup-check — Duplikats-Prüfung für die UI:
   gibt es in easybill schon eine INVOICE mit ref_id=<offer.easybill_document_id>?
   Nutzen: den "Setup-Rechnung erstellen"-Button deaktivieren + verlinken. */
router.get('/offer/:offerId/dup-check', async (req, res) => {
  try {
    const { data: offer } = await supabase.from('talentone_offers').select('*').eq('id', req.params.offerId).maybeSingle();
    if (!offer) return res.status(404).json({ error: 'Angebot nicht gefunden.' });

    // Intern zuerst: existiert schon eine talentone_invoices-Row?
    const { data: local } = await supabase
      .from('talentone_invoices')
      .select('id, easybill_document_id, status, invoice_type, created_at')
      .eq('offer_id', offer.id).eq('invoice_type', 'setup')
      .neq('status', 'cancelled').maybeSingle();
    if (local) return res.json({ duplicate: true, source: 'internal', invoice: local });

    // Und im easybill selbst (Direkt-INVOICE-Fall)?
    const inEasybill = await findExistingInvoiceForOffer(offer).catch(() => null);
    if (inEasybill) {
      return res.json({
        duplicate: true, source: 'easybill',
        easybill_document_id: inEasybill.easybillDocId,
        doc: { id: inEasybill.doc.id, number: inEasybill.doc.number, is_paid: !!inEasybill.doc.is_paid },
      });
    }
    res.json({ duplicate: false });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* POST /api/invoices/setup  body: { offer_id, use_paypal? }
   Idempotent: bei Dup wird die bestehende Rechnung zurückgegeben, nichts neu angelegt. */
router.post('/setup', async (req, res) => {
  const { offer_id, use_paypal } = req.body || {};
  if (!offer_id) return res.status(400).json({ error: 'offer_id ist Pflicht.' });
  try {
    const result = await createSetupInvoice(offer_id, {
      createdBy: req.user?.email || null,
      usePaypal: use_paypal === undefined ? null : !!use_paypal,
    });
    res.status(result.alreadyExists ? 200 : 201).json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* POST /api/invoices/monthly/activate  body: { offer_id, start_date? }
   Setzt campaign_started_at — der Cron übernimmt ab Trigger-Tag. */
router.post('/monthly/activate', async (req, res) => {
  const { offer_id, start_date } = req.body || {};
  if (!offer_id) return res.status(400).json({ error: 'offer_id ist Pflicht.' });
  try {
    const result = await activateMonthlyBilling(offer_id, { startDate: start_date || null });
    res.status(201).json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* POST /api/invoices/monthly/stop  body: { offer_id } */
router.post('/monthly/stop', async (req, res) => {
  const { offer_id } = req.body || {};
  if (!offer_id) return res.status(400).json({ error: 'offer_id ist Pflicht.' });
  try {
    const result = await stopMonthlyBilling(offer_id);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* POST /api/invoices/monthly/reactivate  body: { offer_id, note? }
   Manuelle Team-Entscheidung nach TalentOne max-servicefrei. */
router.post('/monthly/reactivate', async (req, res) => {
  const { offer_id, note } = req.body || {};
  if (!offer_id) return res.status(400).json({ error: 'offer_id ist Pflicht.' });
  try {
    const result = await reactivateMonthlyBilling(offer_id, { note });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* POST /api/invoices/monthly/waive-override  body: { offer_id, active:bool, note? }
   Kulanz-Schalter (Servicefrei trotz laufender Frist). Note ist Pflicht wenn active=true. */
router.post('/monthly/waive-override', async (req, res) => {
  const { offer_id, active, note } = req.body || {};
  if (!offer_id) return res.status(400).json({ error: 'offer_id ist Pflicht.' });
  if (active && !String(note || '').trim()) {
    return res.status(400).json({ error: 'Bei Aktivierung ist eine Notiz Pflicht.' });
  }
  try {
    const { data, error } = await supabase.from('talentone_offers').update({
      service_waived_override: !!active,
      service_waived_note: active ? (note || '') : null,
    }).eq('id', offer_id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ offer: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* POST /api/invoices/monthly/run-now  body: { offer_id, period_start? }
   Manueller Trigger für einzelnes Angebot — z.B. für Tests oder Ad-hoc-Läufe. */
router.post('/monthly/run-now', async (req, res) => {
  const { offer_id, period_start } = req.body || {};
  if (!offer_id) return res.status(400).json({ error: 'offer_id ist Pflicht.' });
  try {
    const result = await runMonthlyBillingForOffer(offer_id, {
      today: new Date(), periodStart: period_start || null,
    });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* POST /api/invoices/monthly/run-cron — Bulk-Trigger, führt eine komplette
   Cron-Runde aus (respektiert BILLING_TRIGGER_DAY). */
router.post('/monthly/run-cron', async (req, res) => {
  try {
    const result = await runMonthlyBillingRound({ today: new Date() });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* GET /api/invoices/monthly/cron-status */
router.get('/monthly/cron-status', (req, res) => res.json(getBillingCronStatus()));

/* POST /api/invoices/reminders/run — manuelle Erinnerungsrunde. */
router.post('/reminders/run', async (req, res) => {
  try { res.json(await runReminderRound()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
/* GET /api/invoices/reminders/status */
router.get('/reminders/status', (req, res) => res.json(getReminderStatus()));

/* GET /api/invoices/skip-log?offer_id=... */
router.get('/skip-log', async (req, res) => {
  const { offer_id, brand } = req.query || {};
  let q = supabase.from('talentone_billing_skip_log').select('*').order('period_start', { ascending: false });
  if (offer_id) q = q.eq('offer_id', offer_id);
  if (brand)    q = q.eq('brand', brand);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ skips: data || [] });
});

/* POST /api/invoices/ad-budget  body: { offer_id, new_amount, reason? } */
router.post('/ad-budget', async (req, res) => {
  const { offer_id, new_amount, reason } = req.body || {};
  if (!offer_id) return res.status(400).json({ error: 'offer_id ist Pflicht.' });
  if (!Number.isFinite(+new_amount)) return res.status(400).json({ error: 'new_amount ungültig.' });
  try {
    const result = await updateAdBudget(offer_id, +new_amount, {
      changedBy: req.user?.email || null, reason: reason || null,
    });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* POST /api/invoices/standalone-ad-budget
   Body: { easybill_customer_id, brand, amount_net, period_label,
           use_paypal?, customer_id? }
   Erzeugt eine Werbekosten-Rechnung ohne Angebots-Bezug. Läuft danach im
   normalen invoice-sync mit — kein Sonderweg für Ampel/Erinnerungen nötig. */
router.post('/standalone-ad-budget', async (req, res) => {
  const { easybill_customer_id, brand, amount_net, period_label,
          use_paypal, customer_id } = req.body || {};
  try {
    const result = await createStandaloneAdBudgetInvoice({
      easybill_customer_id, brand,
      amount_net:   Number(amount_net),
      period_label: String(period_label || '').trim(),
      use_paypal:   !!use_paypal,
      customer_id:  customer_id || null,
      createdBy:    req.user?.email || null,
    });
    res.status(201).json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

/* GET /api/invoices/:id/email-preview — Template + Merge-Tags fürs Send-Modal.
   Nur Rechnungen mit gesetztem easybill_document_id. */
router.get('/:id/email-preview', async (req, res) => {
  try {
    const { data: inv, error } = await supabase
      .from('talentone_invoices').select('*').eq('id', req.params.id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!inv)  return res.status(404).json({ error: 'Rechnung nicht gefunden.' });
    if (!inv.easybill_document_id) {
      return res.status(409).json({ error: 'Rechnung wurde noch nicht in easybill erzeugt.' });
    }

    // Empfänger + Ansprechpartner aus talentone_kunden ziehen
    let kunde = null;
    if (inv.customer_id) {
      const { data } = await supabase.from('talentone_kunden')
        .select('firmenname, ansprechpartner, email, anrede_form, anrede_titel, nachname')
        .eq('id', inv.customer_id).maybeSingle();
      kunde = data || null;
    }

    const { data: templates } = await supabase.from('talentone_offer_templates')
      .select('key, text').eq('brand', inv.brand)
      .in('key', ['invoice_email_subject', 'invoice_email_body']);
    const tplMap = Object.fromEntries((templates || []).map(t => [t.key, t.text]));

    const ctx = {
      // {{anrede}} = "Hallo Marc" / "Hallo Herr Petersen" — je nach Kunden-Anrede.
      anrede:          anrede(kunde),
      ansprechpartner: kunde?.ansprechpartner || 'zusammen',
      firma:           kunde?.firmenname || '',
      period_label:    inv.label || 'Ihre Kampagne',
      betrag_brutto:   new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(inv.amount_gross) || 0),
    };
    const fill = t => String(t || '').replace(/\{\{(\w+)\}\}/g, (_, k) => ctx[k] ?? '');

    res.json({
      subject: fill(tplMap.invoice_email_subject || 'Ihre Rechnung — {{period_label}}'),
      // Fallback in beiden Anrede-Fassungen — vorher stand hier "Hallo <Vorname>"
      // (Du-Gruss) + "erhalten Sie" (Sie-Text), also eine Mischform.
      body:    fill(tplMap.invoice_email_body || t(kunde,
        `{{anrede}},\n\nanbei erhältst du unsere Rechnung als PDF-Anhang.\n\nHerzliche Grüße`,
        `{{anrede}},\n\nanbei erhalten Sie unsere Rechnung als PDF-Anhang.\n\nHerzliche Grüße`)),
      to:      kunde?.email || null,
      firma:   ctx.firma,
      already_sent: !!inv.sent_at,
      sent_to: inv.sent_to,
      sent_at: inv.sent_at,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* POST /api/invoices/:id/send-email  body: { to, subject, body } */
router.post('/:id/send-email', async (req, res) => {
  const { to, subject, body } = req.body || {};
  if (!to || !/.+@.+\..+/.test(String(to))) return res.status(400).json({ error: 'Empfänger-E-Mail fehlt oder ungültig.' });
  if (!subject || !String(subject).trim())  return res.status(400).json({ error: 'Betreff fehlt.' });
  if (!body || !String(body).trim())        return res.status(400).json({ error: 'Text fehlt.' });

  try {
    const { data: inv, error } = await supabase
      .from('talentone_invoices').select('*').eq('id', req.params.id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!inv)  return res.status(404).json({ error: 'Rechnung nicht gefunden.' });
    if (!inv.easybill_document_id) return res.status(409).json({ error: 'Rechnung wurde noch nicht in easybill erzeugt.' });

    // Draft-Guard + Self-Heal: eine Rechnung darf NIE als Entwurf raus.
    // Aktualisiert dabei auch talentone_invoices mit der finalen Nummer
    // (falls das Bestandsdoc noch keine hatte).
    try {
      const { doc } = await ensureFinalized(inv.easybill_document_id);
      if (doc?.number && doc.number !== inv.easybill_invoice_number) {
        await supabase.from('talentone_invoices')
          .update({ easybill_invoice_number: String(doc.number) })
          .eq('id', inv.id);
        inv.easybill_invoice_number = String(doc.number);
      }
    } catch (err) {
      return res.status(502).json({ error: `easybill finalize: ${err.message}` });
    }

    const pdfBuffer = await getDocumentPdf(inv.easybill_document_id);
    let firmaSlug = 'Kunde';
    if (inv.customer_id) {
      const { data: k } = await supabase.from('talentone_kunden')
        .select('firmenname').eq('id', inv.customer_id).maybeSingle();
      firmaSlug = (k?.firmenname || 'Kunde').replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 40) || 'Kunde';
    }
    const pdfFilename = `${firmaSlug}_Rechnung.pdf`;

    await sendRechnungMail({
      to, offerBrand: inv.brand, subject, body, pdfBuffer, pdfFilename,
    });

    const nowIso = new Date().toISOString();
    const { data: updated, error: upErr } = await supabase
      .from('talentone_invoices')
      .update({ sent_at: nowIso, sent_to: to })
      .eq('id', inv.id).select().single();
    if (upErr) return res.status(500).json({ error: upErr.message });

    // Close-Notiz best-effort: Lead-Anker liegt bei den Angeboten. Wenn die
    // Rechnung standalone ist, gibt es keinen. Deshalb hier nur, wenn wir per
    // offer_id auf einen Lead kommen können.
    if (inv.offer_id) {
      const { data: offer } = await supabase.from('talentone_offers')
        .select('close_lead_id').eq('id', inv.offer_id).maybeSingle();
      if (offer?.close_lead_id) {
        const brandLabel = inv.brand === 'nowag_wirth' ? 'Nowag & Wirth' : 'TalentOne';
        closeAddNote({
          leadId: offer.close_lead_id,
          note: `📄 Rechnung per E-Mail versendet: ${brandLabel} — an ${to}`,
        }).catch(err => console.warn('[invoices/send-email close]', err.message));
      }
    }

    res.json({ ok: true, invoice: updated });
  } catch (err) {
    console.error('[invoices/send-email]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* POST /api/invoices/sync — Bulk-Trigger für den Rechnungs-Sync.
   Optional { customer_id }: dann läuft nur der Sync und die Ampel-Auswertung
   im vollen Rahmen — Rechnungen werden global aktualisiert, aber der Client
   ruft den Endpoint kontextabhängig auf, um seine eigene Sicht zu refreshen. */
router.post('/sync', async (req, res) => {
  try {
    const result = await syncOpenInvoices();
    const campaign = await evaluateCampaignPaymentStatus();
    res.json({ result, campaign });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* GET /api/invoices/sync/status */
router.get('/sync/status', (req, res) => res.json(getInvoiceSyncStatus()));

export default router;
