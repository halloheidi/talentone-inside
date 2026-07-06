// easybill-Webhook — läuft in eigenem Router, damit der Raw-Body für die
// HMAC-Signatur-Verifikation ankommt (globaler express.json würde den
// Body vorher konsumieren).
//
// Registrierung in easybill (falls aktiviert): POST /webhooks mit
//   url: https://inside.talent-one.de/api/webhooks/easybill
//   secret: <EASYBILL_WEBHOOK_SECRET>
//   events: ['document.create', 'document.update', 'document.payment_add']
//   content_type: 'json'
//
// Auth-Modi (nachdem Secret gesetzt):
//   1) ?secret=<X> im URL (analog zum Perspective-Webhook-Muster)
//   2) HMAC-SHA256(body) im X-Easybill-Signature-Header
//   Wir akzeptieren beide — welche easybill nutzt, kann per Web-UI konfiguriert
//   werden. Ohne EASYBILL_WEBHOOK_SECRET akzeptieren wir alles (mit WARN-Log).

import express from 'express';
import crypto from 'crypto';
import { supabase } from '../supabase.js';
import { applyAcceptedTransition } from '../offer-sync.js';
import { getDocument } from '../easybill.js';

const router = express.Router();

router.post('/', express.raw({ type: '*/*', limit: '2mb' }), async (req, res) => {
  const rawBuf = req.body; // Buffer
  const secret = process.env.EASYBILL_WEBHOOK_SECRET;
  const querySecret = (req.query || {}).secret;
  const sigHeader = req.headers['x-easybill-signature'];

  if (secret) {
    let ok = false;
    if (querySecret && timingSafeEq(String(querySecret), secret)) ok = true;
    if (!ok && sigHeader) {
      const computed = crypto.createHmac('sha256', secret).update(rawBuf).digest('hex');
      if (timingSafeEq(String(sigHeader), computed)) ok = true;
    }
    if (!ok) return res.status(401).json({ error: 'invalid secret/signature' });
  } else {
    console.warn('[easybill-webhook] EASYBILL_WEBHOOK_SECRET nicht gesetzt — akzeptiere ungeprüft.');
  }

  let payload;
  try { payload = JSON.parse(rawBuf.toString('utf8') || '{}'); }
  catch (err) { return res.status(400).json({ error: 'invalid JSON' }); }

  // Payload-Shape tolerant lesen (easybill dokumentiert die genaue Struktur
  // in den WebHook-Docs nicht in der OpenAPI-Spec).
  const event = payload.event || payload.type || null;
  const data  = payload.data  || payload.document || payload || {};
  const docId = data?.id ?? payload?.id ?? null;
  const refId = data?.ref_id ?? payload?.ref_id ?? null;
  const type  = data?.type ?? payload?.type ?? null;

  const isCreateOrUpdate = !event || /document\.(create|update)/i.test(event);
  if (isCreateOrUpdate && refId && (type === 'CHARGE_CONFIRM' || type === 'INVOICE')) {
    try {
      const { data: offer } = await supabase
        .from('talentone_offers')
        .select('*')
        .eq('easybill_document_id', String(refId))
        .maybeSingle();
      if (!offer) return res.json({ ok: true, note: 'no matching offer' });

      // Vollständiges Doc holen, falls Payload nicht alle Felder mitliefert.
      const full = docId ? await getDocument(docId).catch(() => data) : data;
      await applyAcceptedTransition(offer, full);
      return res.json({ ok: true, offer_id: offer.id, easybill_doc_id: docId });
    } catch (err) {
      console.error('[easybill-webhook] Transition fehlgeschlagen:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  res.json({ ok: true, note: 'event ignored' });
});

function timingSafeEq(a, b) {
  const ba = Buffer.from(a || '');
  const bb = Buffer.from(b || '');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export default router;
