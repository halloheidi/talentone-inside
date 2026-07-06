// Abrechnungs-Routen (Phase 5) — Setup-Rechnung, monatliches Abo,
// Werbebudget, Beenden, Manual-Sync, PDF.

import { Router } from 'express';
import { supabase } from '../supabase.js';
import { getDocumentPdf } from '../easybill.js';
import {
  createSetupInvoice,
  activateMonthlyBilling,
  stopMonthlyBilling,
  reactivateMonthlyBilling,
  updateAdBudget,
  findExistingInvoiceForOffer,
  runMonthlyBillingForOffer,
} from '../invoice-service.js';
import { runMonthlyBillingRound, getBillingCronStatus } from '../billing-scheduler.js';
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

/* POST /api/invoices/sync — Bulk-Trigger für den Rechnungs-Sync. */
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
