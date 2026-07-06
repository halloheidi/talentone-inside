// PayPal Webhook-Endpoint — wird in server.js OHNE requireAuth gemountet.
// PayPal ruft hier bei Events wie INVOICING.INVOICE.PAID auf.

import { Router } from 'express';
import { supabase } from '../supabase.js';
import { verifyWebhookSignature, mapStatus } from '../paypal.js';

const router = Router();

const INVOICE_EVENTS = new Set([
  'INVOICING.INVOICE.PAID',
  'INVOICING.INVOICE.CANCELLED',
  'INVOICING.INVOICE.REFUNDED',
  'INVOICING.INVOICE.UPDATED',
  'INVOICING.INVOICE.SCHEDULED',
]);

router.post('/', async (req, res) => {
  // Sofort 200 OK an PayPal — wir verarbeiten async, damit Retries nicht stören.
  res.status(200).json({ ok: true });

  (async () => {
    try {
      const event = req.body;
      const eventType = event?.event_type;
      if (!eventType || !INVOICE_EVENTS.has(eventType)) {
        // Andere Events ignorieren (z.B. Subscription, Payment etc.)
        return;
      }

      // Signatur verifizieren (best-effort, blockt aber Verarbeitung wenn fehlschlägt)
      const ok = await verifyWebhookSignature({ headers: req.headers, body: event });
      if (!ok) {
        console.warn('[PayPal-Webhook] Signatur-Verifikation fehlgeschlagen — Event verworfen:', eventType);
        return;
      }

      const resource = event.resource || {};
      const invoiceId = resource.id || resource.invoice?.id;
      if (!invoiceId) {
        console.warn('[PayPal-Webhook] Kein invoice_id im Event:', eventType);
        return;
      }

      // NEU (Phase 5): erst gegen talentone_invoices matchen (Angebots-System)
      const { data: newInvoice } = await supabase
        .from('talentone_invoices')
        .select('*')
        .eq('paypal_reference', invoiceId)
        .maybeSingle();
      if (newInvoice) {
        return await handlePhase5InvoicePayment({ event, resource, invoiceId, eventType, invoice: newInvoice });
      }

      // ALT (talentone_zahlungen): bestehendes Direkt-PayPal-System
      const { data: zahlung, error: findErr } = await supabase
        .from('talentone_zahlungen')
        .select('*')
        .eq('paypal_invoice_id', invoiceId)
        .maybeSingle();
      if (findErr) {
        console.warn('[PayPal-Webhook] DB-Lookup fehlgeschlagen:', findErr.message);
        return;
      }
      if (!zahlung) {
        // Rechnung nicht in unserer DB (evtl. extern angelegt) — ignorieren
        console.log('[PayPal-Webhook] Invoice unbekannt:', invoiceId, eventType);
        return;
      }

      // Status mappen — bei PAID-Event Status hart auf 'bezahlt' setzen
      let newStatus = mapStatus(resource.status);
      if (eventType === 'INVOICING.INVOICE.PAID') newStatus = 'bezahlt';
      if (eventType === 'INVOICING.INVOICE.CANCELLED') newStatus = 'storniert';
      if (eventType === 'INVOICING.INVOICE.REFUNDED') newStatus = 'storniert';

      const bezahltAm = newStatus === 'bezahlt'
        ? (resource.payments?.transactions?.[0]?.payment_date
            ? new Date(resource.payments.transactions[0].payment_date).toISOString()
            : new Date().toISOString())
        : zahlung.bezahlt_am;

      const { error: updErr } = await supabase
        .from('talentone_zahlungen')
        .update({
          status: newStatus,
          bezahlt_am: bezahltAm,
          raw_paypal: resource,
          updated_at: new Date().toISOString(),
        })
        .eq('id', zahlung.id);

      if (updErr) {
        console.warn('[PayPal-Webhook] Update fehlgeschlagen:', updErr.message);
      } else {
        console.log(`[PayPal-Webhook] ${eventType} → Zahlung ${zahlung.id.slice(0,8)} = ${newStatus}`);
      }

      // Bei PAID: automatisch easybill-Rechnung erzeugen (best-effort)
      if (newStatus === 'bezahlt' && process.env.EASYBILL_API_KEY) {
        try {
          const { triggerEasybillForZahlung } = await import('./zahlungen.js');
          const result = await triggerEasybillForZahlung(zahlung.id);
          if (result.error) console.warn('[easybill-auto]', result.error);
          else console.log(`[easybill-auto] Rechnung erstellt für Zahlung ${zahlung.id.slice(0,8)}`);
        } catch (err) { console.warn('[easybill-auto]', err.message); }
      }
    } catch (err) {
      console.error('[PayPal-Webhook] Unerwarteter Fehler:', err.message);
    }
  })().catch(err => console.error('[PayPal-Webhook] uncaught:', err.message));
});

/* Phase-5-Zahlungshandler: PayPal-Zahlung für talentone_invoices verbuchen +
   in easybill als Zahlung eintragen (damit easybill die Rechnung als bezahlt
   markiert und die Buchhaltung führend bleibt). Idempotent — bei
   Doppel-Events wird nur last_synced_at aktualisiert. */
async function handlePhase5InvoicePayment({ event, resource, invoiceId, eventType, invoice }) {
  const isPaid = eventType === 'INVOICING.INVOICE.PAID';
  const nowIso = new Date().toISOString();

  // Idempotenz-Kern
  if (invoice.status === 'paid' && invoice.paid_at) {
    await supabase.from('talentone_invoices')
      .update({ last_synced_at: nowIso }).eq('id', invoice.id);
    return;
  }

  if (!isPaid) {
    // Andere Events nur Status abbilden (partial/cancelled)
    let newStatus = invoice.status;
    if (eventType === 'INVOICING.INVOICE.CANCELLED') newStatus = 'cancelled';
    else if (eventType === 'INVOICING.INVOICE.REFUNDED') newStatus = 'cancelled';
    await supabase.from('talentone_invoices')
      .update({ status: newStatus, last_synced_at: nowIso }).eq('id', invoice.id);
    return;
  }

  // PAID: PayPal-Zahlung in easybill buchen
  const paymentDate = resource.payments?.transactions?.[0]?.payment_date
    ? String(resource.payments.transactions[0].payment_date).slice(0, 10)
    : nowIso.slice(0, 10);
  const paypalTxRef = resource.payments?.transactions?.[0]?.payment_id
    || resource.id || invoiceId;

  try {
    if (invoice.easybill_document_id) {
      const { bookDocumentPayment } = await import('../easybill.js');
      await bookDocumentPayment({
        documentId: invoice.easybill_document_id,
        amountCents: Math.round(Number(invoice.amount_gross || 0) * 100),
        provider: 'PayPal',
        reference: paypalTxRef,
        paymentAt: paymentDate,
        markPaid: true,
      });
      console.log(`[PayPal-Webhook] easybill payment gebucht für invoice ${invoice.id.slice(0,8)}`);
    }
  } catch (err) {
    console.warn(`[PayPal-Webhook] easybill payment fehlgeschlagen für ${invoice.id.slice(0,8)}: ${err.message}`);
  }

  await supabase.from('talentone_invoices').update({
    status: 'paid',
    paid_at: new Date(paymentDate).toISOString(),
    last_synced_at: nowIso,
  }).eq('id', invoice.id);
  console.log(`[PayPal-Webhook] talentone_invoices ${invoice.id.slice(0,8)} → paid`);
}

export default router;
