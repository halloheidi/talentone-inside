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

      // Zugehörige Zahlung in unserer DB finden
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
    } catch (err) {
      console.error('[PayPal-Webhook] Unerwarteter Fehler:', err.message);
    }
  })().catch(err => console.error('[PayPal-Webhook] uncaught:', err.message));
});

export default router;
