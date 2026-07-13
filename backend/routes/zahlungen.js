// Zahlungen — PayPal-Invoicing-Integration.
// Geschützt (requireAuth) für CRUD. Webhook ohne Auth (separat in server.js mounten).

import { Router } from 'express';
import { supabase } from '../supabase.js';
import { createInvoice, fetchInvoice, mapStatus } from '../paypal.js';
import { sendZahlungsMail, sendRechnungsMail } from '../mail.js';
import { notifyKunde } from '../close.js';
import * as easybill from '../easybill.js';
import { getBranding } from '../branding.js';

const router = Router();

function parseAmount(input) {
  if (input == null) return null;
  // Akzeptiert "1500", "1500,00", "1.500,00", "1500.00" → Cent
  const s = String(input).trim().replace(/\s+/g, '').replace(/€/g, '');
  const normalized = s.replace(/\./g, '').replace(',', '.');
  const num = Number(normalized);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num * 100);
}

/* GET /api/zahlungen?job_id=... — alle Zahlungen (optional gefiltert) */
router.get('/', async (req, res) => {
  let q = supabase
    .from('talentone_zahlungen')
    .select('*, talentone_jobs!inner(id, stelle, kunde_id, talentone_kunden!inner(id, firmenname, email, agentur))')
    .order('created_at', { ascending: false });
  if (req.query.job_id) q = q.eq('job_id', req.query.job_id);
  if (req.query.kunde_id) q = q.eq('kunde_id', req.query.kunde_id);
  if (req.query.status) q = q.eq('status', req.query.status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ zahlungen: data || [] });
});

/* POST /api/zahlungen/job/:jobId
   body: { betrag_netto, kleinunternehmer?, beschreibung?, leistungszeitraum?, faelligkeit? } */
router.post('/job/:jobId', async (req, res) => {
  const { betrag_netto, kleinunternehmer, beschreibung, leistungszeitraum, faelligkeit } = req.body || {};
  const nettoCent = parseAmount(betrag_netto);
  if (!nettoCent) return res.status(400).json({ error: 'Bitte einen gültigen Netto-Betrag eingeben.' });

  const klein = !!kleinunternehmer;
  const mwstCent   = klein ? 0 : Math.round(nettoCent * 0.19);
  const bruttoCent = nettoCent + mwstCent;

  try {
    const { data: job } = await supabase
      .from('talentone_jobs').select('*').eq('id', req.params.jobId).maybeSingle();
    if (!job) return res.status(404).json({ error: 'Job nicht gefunden.' });
    const { data: kunde } = await supabase
      .from('talentone_kunden').select('*').eq('id', job.kunde_id).maybeSingle();
    if (!kunde) return res.status(404).json({ error: 'Kunde nicht gefunden.' });

    const desc = beschreibung?.trim()
      || `Werbebudget ${job.stelle || 'Stelle'} — ${kunde.firmenname || 'Kunde'}`;

    // PayPal-Invoice immer auf BRUTTO
    const invoice = await createInvoice({
      amountCent: bruttoCent,
      description: desc,
      faelligkeit: faelligkeit || null,
      customerEmail: kunde.email,
      customerName: kunde.firmenname,
    });

    const paypalStatus = invoice.detail?.status;
    const status = mapStatus(paypalStatus);

    const { data, error } = await supabase
      .from('talentone_zahlungen')
      .insert({
        job_id: job.id,
        kunde_id: kunde.id,
        paypal_invoice_id: invoice.id,
        paypal_invoice_number: invoice.invoice_number,
        pay_link: invoice.pay_link,
        betrag_cent: bruttoCent,
        betrag_netto: nettoCent,
        betrag_mwst: mwstCent,
        betrag_brutto: bruttoCent,
        kleinunternehmer: klein,
        leistungszeitraum: leistungszeitraum || null,
        waehrung: 'EUR',
        beschreibung: desc,
        faelligkeit: faelligkeit || null,
        status,
        raw_paypal: invoice.detail,
      })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ zahlung: data });
  } catch (err) {
    console.error('[zahlung-create]', err.message);
    res.status(502).json({ error: err.message });
  }
});

/* POST /api/zahlungen/:id/easybill/manual — Fallback: easybill-Rechnung manuell anstoßen */
router.post('/:id/easybill/manual', async (req, res) => {
  const result = await triggerEasybillForZahlung(req.params.id);
  if (result.error) return res.status(502).json({ error: result.error });
  res.json({ zahlung: result.zahlung });
});

/* GET /api/zahlungen/:id/pdf — PDF aus easybill streamen */
router.get('/:id/pdf', async (req, res) => {
  const { data: z } = await supabase
    .from('talentone_zahlungen').select('easybill_id, easybill_invoice_number, beschreibung')
    .eq('id', req.params.id).maybeSingle();
  if (!z?.easybill_id) return res.status(404).json({ error: 'Keine easybill-Rechnung verknüpft.' });
  try {
    const pdf = await easybill.getInvoicePdf(z.easybill_id);
    const fname = `${z.easybill_invoice_number || 'rechnung'}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.send(pdf);
  } catch (err) { res.status(502).json({ error: err.message }); }
});

/* POST /api/zahlungen/:id/rechnung/send — Rechnung als PDF-Anhang an Kunden */
router.post('/:id/rechnung/send', async (req, res) => {
  const { to } = req.body || {};
  const { data: z } = await supabase
    .from('talentone_zahlungen').select('*').eq('id', req.params.id).maybeSingle();
  if (!z) return res.status(404).json({ error: 'Zahlung nicht gefunden.' });
  if (!z.easybill_id) return res.status(400).json({ error: 'Keine easybill-Rechnung — bitte erst erstellen.' });

  const { data: kunde } = await supabase
    .from('talentone_kunden').select('*').eq('id', z.kunde_id).maybeSingle();
  const recipientRaw = (to || kunde?.email || '').toString();
  const recipients = recipientRaw.split(/[,;]/).map(s => s.trim()).filter(s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
  if (recipients.length === 0) return res.status(400).json({ error: 'Keine gültige Empfänger-Mail.' });

  try {
    const pdf = await easybill.getInvoicePdf(z.easybill_id);
    await sendRechnungsMail({
      to: recipients,
      kunde, zahlung: z,
      pdfBuffer: pdf,
      pdfFilename: `${z.easybill_invoice_number || 'rechnung'}.pdf`,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[rechnung-send]', err.message);
    res.status(502).json({ error: err.message });
  }
});

/* ════════════ Easybill-Erzeugung (shared mit Webhook) ════════════ */

export async function triggerEasybillForZahlung(zahlungId) {
  if (!process.env.EASYBILL_API_KEY) return { error: 'EASYBILL_API_KEY nicht gesetzt.' };

  const { data: z } = await supabase
    .from('talentone_zahlungen').select('*').eq('id', zahlungId).maybeSingle();
  if (!z) return { error: 'Zahlung nicht gefunden.' };
  if (z.easybill_id) return { zahlung: z }; // schon erstellt

  const { data: kunde } = await supabase
    .from('talentone_kunden').select('*').eq('id', z.kunde_id).maybeSingle();
  if (!kunde) return { error: 'Kunde nicht gefunden.' };

  try {
    const customer = await easybill.findOrCreateCustomer({
      firmenname: kunde.firmenname,
      ansprechpartner: kunde.ansprechpartner,
      email: kunde.email,
      telefon: kunde.telefon,
      strasse: kunde.strasse || null,
      plz: kunde.plz || null,
      ort: kunde.ort || null,
      land: 'DE',
    });
    const customerId = customer?.id;
    if (!customerId) throw new Error('Keine easybill-customer_id erhalten.');

    const paidAt = z.bezahlt_am || new Date().toISOString();
    const invoice = await easybill.createInvoice({
      customerId,
      beschreibung: z.beschreibung || 'Werbebudget',
      nettoCent: z.betrag_netto || Math.round((z.betrag_brutto || z.betrag_cent) / 1.19),
      steuerProzent: z.kleinunternehmer ? 0 : 19,
      kleinunternehmer: !!z.kleinunternehmer,
      leistungszeitraum: z.leistungszeitraum || null,
      paidAtIso: paidAt,
      externalReference: z.paypal_invoice_id || z.id,
    });
    const invoiceId = invoice?.id;
    if (!invoiceId) throw new Error('Keine easybill-document_id erhalten.');

    // Finalisieren (auf "done" setzen, holt Rechnungsnummer)
    let finalized;
    try { finalized = await easybill.finalizeInvoice(invoiceId); }
    catch (err) { console.warn('[easybill-finalize]', err.message); finalized = invoice; }

    const invNumber = finalized?.number || invoice?.number || null;

    const { data: updated } = await supabase
      .from('talentone_zahlungen')
      .update({
        easybill_id: String(invoiceId),
        easybill_invoice_number: invNumber,
        easybill_status: 'erstellt',
        updated_at: new Date().toISOString(),
      })
      .eq('id', zahlungId).select().single();
    return { zahlung: updated };
  } catch (err) {
    console.error('[easybill-create]', err.message);
    await supabase.from('talentone_zahlungen')
      .update({ easybill_status: `fehler: ${err.message.slice(0,120)}` })
      .eq('id', zahlungId);
    return { error: err.message };
  }
}

/* POST /api/zahlungen/:id/send  body: { to? (Komma-Liste) } — schickt brand-eigene Mail mit Pay-Link */
router.post('/:id/send', async (req, res) => {
  const { to } = req.body || {};

  const { data: z, error } = await supabase
    .from('talentone_zahlungen').select('*').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!z) return res.status(404).json({ error: 'Zahlung nicht gefunden.' });

  const { data: job } = await supabase.from('talentone_jobs').select('*').eq('id', z.job_id).maybeSingle();
  const { data: kunde } = await supabase.from('talentone_kunden').select('*').eq('id', z.kunde_id).maybeSingle();

  const recipientRaw = (to || job?.bewerbung_email || kunde?.email || '').toString();
  const recipients = recipientRaw.split(/[,;]/).map(s => s.trim()).filter(s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
  if (recipients.length === 0) return res.status(400).json({ error: 'Keine gültige Empfänger-Mail.' });

  try {
    await sendZahlungsMail({
      to: recipients,
      kunde, job, zahlung: z,
    });
    const { data: updated } = await supabase
      .from('talentone_zahlungen')
      .update({
        gesendet_an: recipients.join(', '),
        gesendet_am: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', z.id).select().single();

    // Close-Note (best-effort)
    const betragEuro = z.betrag_cent != null
      ? (z.betrag_cent / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
      : '';
    if (kunde) {
      notifyKunde(kunde, `💳 Zahlungslink${betragEuro ? ` über ${betragEuro}` : ''} gesendet am ${new Date().toLocaleDateString('de-DE')}`)
        .catch(err => console.warn('[zahlung-send close-note]', err.message));
    }
    res.json({ zahlung: updated });
  } catch (err) {
    console.error('[zahlung-send]', err.message);
    res.status(502).json({ error: err.message });
  }
});

/* POST /api/zahlungen/:id/refresh — Status aktualisieren von PayPal */
router.post('/:id/refresh', async (req, res) => {
  const { data: z, error } = await supabase
    .from('talentone_zahlungen').select('*').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!z) return res.status(404).json({ error: 'Zahlung nicht gefunden.' });
  if (!z.paypal_invoice_id) return res.status(400).json({ error: 'Keine PayPal-ID gespeichert.' });

  try {
    const detail = await fetchInvoice(z.paypal_invoice_id);
    const newStatus = mapStatus(detail?.status);
    const bezahltAm = newStatus === 'bezahlt' && !z.bezahlt_am
      ? (detail?.payments?.transactions?.[0]?.payment_date
         ? new Date(detail.payments.transactions[0].payment_date).toISOString()
         : new Date().toISOString())
      : z.bezahlt_am;

    const { data: updated } = await supabase
      .from('talentone_zahlungen')
      .update({
        status: newStatus,
        bezahlt_am: bezahltAm,
        raw_paypal: detail,
        updated_at: new Date().toISOString(),
      })
      .eq('id', z.id).select().single();
    res.json({ zahlung: updated });
  } catch (err) {
    console.error('[zahlung-refresh]', err.message);
    res.status(502).json({ error: err.message });
  }
});

/* DELETE /api/zahlungen/:id — nur lokal löschen, PayPal-Rechnung bleibt */
router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('talentone_zahlungen').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

export default router;
