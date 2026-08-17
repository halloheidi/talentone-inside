// Angebote (talentone_offers): Live-Berechnung, Draft-CRUD, Liste.
// Die easybill-Erzeugung folgt in Phase 3.

import { Router } from 'express';
import { supabase } from '../supabase.js';
import { anrede } from '../anrede.js';
import { calculateOfferTotals, validateAdBudget, aggregateSnapshot, resolveOfferPositions, validatePositions } from '../offer-calc.js';
import { buildEasybillOfferPayload } from '../offer-easybill-builder.js';
import { createOffer, createChargeConfirm, getDocument, getDocumentPdf, listPdfTemplates, ensureFinalized } from '../easybill.js';
import { getPdfTemplate, getPdfTemplateConfig } from '../easybill-templates.js';
import { syncOne, syncOpenOffers, getOfferSyncStatus } from '../offer-sync.js';
import { sendAngebotMail, sendAuftragMail } from '../mail.js';
import { addNote as closeAddNote } from '../close.js';
import { buildEckdatenBlock } from '../mail-eckdaten.js';
import { ensureProjektForOffer } from '../auftrag-automation.js';
import { resolveKundeIdForOffer, linkOfferToKunde } from '../offer-linking.js';

const router = Router();

const BRANDS = new Set(['talentone', 'nowag_wirth']);
// Extra-Job-Positionen je Marke: Setup + Monthly werden gekoppelt gesteuert
// über additional_positions_count. Muss in offer-easybill-builder.js
// synchron bleiben.
const EXTRA_JOB_SKUS_BY_BRAND = {
  talentone:   ['TO-OPT-EXTRA-JOB-SETUP', 'TO-OPT-EXTRA-JOB'],
  nowag_wirth: ['NW-OPT-EXTRA-JOB-SETUP', 'NW-OPT-EXTRA-JOB'],
};

// Deutsche Zahlenformatierung wie im Frontend
const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

/* Ersetzt {{keys}} im E-Mail-Body durch die Angebotsdaten. */
function fillMergeTags(text, ctx) {
  return String(text || '').replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = ctx[k];
    return v == null ? '' : String(v);
  });
}

// kunde (optional) traegt die Anrede-Felder; ohne ihn faellt {{anrede}} auf den
// Snapshot-Namen in Du-Form zurueck.
function buildOfferMergeCtx(offer, kunde = null) {
  const snap = offer.customer_snapshot || {};
  const anredeKunde = kunde || { ansprechpartner: [snap.first_name, snap.last_name].filter(Boolean).join(' ').trim() };
  return {
    anrede:          anrede(anredeKunde),
    ansprechpartner: [snap.first_name, snap.last_name].filter(Boolean).join(' ').trim() || 'zusammen',
    firma:           snap.company_name || '',
    setup:           eur.format(Number(offer.setup_total || 0)),
    monatlich:       eur.format(Number(offer.monthly_total || 0)),
    monat_1:         eur.format(Number(offer.first_month_total || 0)),
    werbebudget:     offer.ad_budget_monthly ? eur.format(Number(offer.ad_budget_monthly)) : '',
  };
}


// Laedt den verknuepften Kunden (fuer die Anrede) — best-effort.
async function loadAnredeKunde(offer) {
  if (!offer?.customer_id) return null;
  const { data } = await supabase.from('talentone_kunden')
    .select('ansprechpartner, anrede_form, anrede_titel, nachname')
    .eq('id', offer.customer_id).maybeSingle();
  return data || null;
}

/**
 * Rendert den {{eckdaten}}-Block für dieses Angebot durch serverseitige
 * Neuberechnung. Nutzt denselben Positions-Contract wie easybill —
 * einzige Wahrheit, damit die Zeilensumme immer den Gesamtbetrag ergibt.
 */
async function buildEckdatenForOffer(offer) {
  const { data: products } = await supabase
    .from('talentone_offer_products').select('*').eq('brand', offer.brand).eq('active', true);
  const positions = resolveOfferPositions(offer, products || []);
  const totals = aggregateSnapshot({
    positions,
    ad_budget_monthly:  offer.werbebudget_modus === 'empfehlung' ? null : offer.ad_budget_monthly,
    vat_rate:           Number(offer.vat_rate) || 19,
    discount_type:      offer.discount_type || null,
    discount_value:     Number(offer.discount_value) || 0,
  });
  return buildEckdatenBlock({
    brand:              offer.brand,
    positions:          totals.positions,
    setup_total:        totals.setup_total,
    ad_budget_monthly:  totals.ad_budget_monthly,
    first_month_total:  totals.first_month_total,
  });
}

async function loadOfferEmailTemplate(brand) {
  const { data } = await supabase
    .from('talentone_offer_templates').select('key, text').eq('brand', brand)
    .in('key', ['offer_email_subject', 'offer_email_body']);
  const map = Object.fromEntries((data || []).map(t => [t.key, t.text]));
  return {
    subject: map.offer_email_subject || 'Ihr Angebot',
    body:    map.offer_email_body    || '',
  };
}

async function loadOrderEmailTemplate(brand) {
  const { data } = await supabase
    .from('talentone_offer_templates').select('key, text').eq('brand', brand)
    .in('key', ['order_email_subject', 'order_email_body']);
  const map = Object.fromEntries((data || []).map(t => [t.key, t.text]));
  return {
    subject: map.order_email_subject || 'Ihre Auftragsbestätigung',
    body:    map.order_email_body    || '',
  };
}

/* GET /api/offers/:id/email-preview — liefert Template + aufgelöste
   Merge-Tags fürs Send-Modal. Default-Empfänger = customer_snapshot.email. */
router.get('/:id/email-preview', async (req, res) => {
  const { data: offer, error } = await supabase
    .from('talentone_offers').select('*').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!offer) return res.status(404).json({ error: 'Angebot nicht gefunden.' });

  const tpl = await loadOfferEmailTemplate(offer.brand);
  const ctx = buildOfferMergeCtx(offer, await loadAnredeKunde(offer));
  ctx.eckdaten = await buildEckdatenForOffer(offer);
  const subject = fillMergeTags(tpl.subject, ctx);
  const body    = fillMergeTags(tpl.body, ctx);

  const defaultTo = offer.customer_snapshot?.email || null;

  // Flyer je Marke — Metadata + Absatz-Baustein
  const [{ data: asset }, { data: flyerTpl }] = await Promise.all([
    supabase.from('talentone_brand_assets')
      .select('filename').eq('brand', offer.brand).eq('asset_key', 'offer_flyer').maybeSingle(),
    supabase.from('talentone_offer_templates')
      .select('text').eq('brand', offer.brand).eq('key', 'offer_email_flyer_paragraph').maybeSingle(),
  ]);
  const flyer_paragraph = fillMergeTags(flyerTpl?.text || '', ctx);

  res.json({
    subject, body,
    to: defaultTo,
    firma: ctx.firma,
    already_sent: !!offer.sent_at,
    sent_to: offer.sent_to,
    sent_at: offer.sent_at,
    flyer_available: !!asset,
    flyer_filename:  asset?.filename || null,
    flyer_paragraph,
  });
});

/* POST /api/offers/:id/send-email  body: { to, subject, body }
   Zieht PDF aus easybill, versendet, speichert status/sent_at/sent_to,
   hängt (falls close_lead_id) eine Notiz an den Close-Lead. */
router.post('/:id/send-email', async (req, res) => {
  const { to, subject, body, attach_flyer = false } = req.body || {};
  if (!to || !/.+@.+\..+/.test(String(to))) return res.status(400).json({ error: 'Empfänger-E-Mail fehlt oder ungültig.' });
  if (!subject || !String(subject).trim())  return res.status(400).json({ error: 'Betreff fehlt.' });
  if (!body || !String(body).trim())        return res.status(400).json({ error: 'Text fehlt.' });

  try {
    const { data: offer, error } = await supabase
      .from('talentone_offers').select('*').eq('id', req.params.id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!offer) return res.status(404).json({ error: 'Angebot nicht gefunden.' });
    if (!offer.easybill_document_id) {
      return res.status(409).json({ error: 'Angebot wurde noch nicht in easybill erzeugt.' });
    }

    // Angebote sind bewusst Draft im Katalog — für den Versand aber
    // finalisieren, damit der Kunde nie ein „Entwurf"-Wasserzeichen sieht.
    // Idempotent: bereits finalisierte Docs bleiben unverändert.
    try {
      await ensureFinalized(offer.easybill_document_id);
    } catch (err) {
      return res.status(502).json({ error: `easybill finalize: ${err.message}` });
    }

    const pdfBuffer = await getDocumentPdf(offer.easybill_document_id);
    const firma = (offer.customer_snapshot?.company_name || 'Angebot').replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 40) || 'Angebot';
    const pdfFilename = `${firma}_Angebot.pdf`;

    // Optional: Flyer als 2. Anhang (best-effort — bei Fehler ohne Flyer senden)
    let flyerBuffer = null, flyerFilename = null, flyerWarn = null;
    if (attach_flyer) {
      try {
        const { data: asset } = await supabase.from('talentone_brand_assets')
          .select('*').eq('brand', offer.brand).eq('asset_key', 'offer_flyer').maybeSingle();
        if (asset) {
          const { downloadFromBucket } = await import('../storage.js');
          flyerBuffer = await downloadFromBucket({ bucket: 'brand-assets', path: asset.storage_path });
          flyerFilename = asset.filename;
        } else {
          flyerWarn = 'Kein Flyer hinterlegt.';
        }
      } catch (err) {
        console.warn('[offers/send-email flyer]', err.message);
        flyerWarn = `Flyer nicht ladbar: ${err.message}`;
      }
    }

    // Wenn Flyer nicht ladbar: den Flyer-Absatz aus dem Body entfernen, damit
    // der Empfänger nicht ratlos nach dem Anhang sucht. Der Absatz ist der
    // Text, den das Modal aus flyer_paragraph eingesetzt hat — wir erkennen ihn
    // nicht sicher, deshalb entfernt der Aufrufer ihn selbst wenn er den
    // Warnhinweis zurückbekommt. Hier senden wir den Body unverändert.
    const flyerAttached = !!flyerBuffer;

    await sendAngebotMail({
      to, offerBrand: offer.brand, subject, body, pdfBuffer, pdfFilename,
      extraAttachments: flyerAttached ? [{ filename: flyerFilename, content: flyerBuffer }] : [],
    });

    const nowIso = new Date().toISOString();
    const nextStatus = offer.status === 'accepted' ? 'accepted' : 'sent';
    const { data: updated, error: upErr } = await supabase
      .from('talentone_offers')
      .update({ status: nextStatus, sent_at: nowIso, sent_to: to })
      .eq('id', offer.id).select().single();
    if (upErr) return res.status(500).json({ error: upErr.message });

    if (offer.close_lead_id) {
      const monat1 = eur.format(Number(offer.first_month_total || 0));
      const brandLabel = offer.brand === 'nowag_wirth' ? 'Nowag & Wirth' : 'TalentOne';
      closeAddNote({
        leadId: offer.close_lead_id,
        note: `📧 Angebot per E-Mail versendet${flyerAttached ? ' (mit Flyer)' : ''}: ${brandLabel} — Monat 1: ${monat1} — an ${to}`,
      }).catch(err => console.warn('[offers/send-email close]', err.message));
    }

    res.json({ ok: true, offer: updated, flyer_attached: flyerAttached, flyer_warn: flyerWarn });
  } catch (err) {
    console.error('[offers/send-email]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* GET /api/offers/:id/order-email-preview — Template + Merge-Tags fürs AB-Send-Modal.
   Verfügbar für ALLE Angebote mit gesetztem easybill_order_document_id
   (also sowohl Direkt-ABs als auch die klassisch aus Angebot→AB entstandenen). */
router.get('/:id/order-email-preview', async (req, res) => {
  const { data: offer, error } = await supabase
    .from('talentone_offers').select('*').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!offer) return res.status(404).json({ error: 'Angebot nicht gefunden.' });
  if (!offer.easybill_order_document_id) {
    return res.status(409).json({ error: 'Für dieses Angebot existiert noch keine Auftragsbestätigung in easybill.' });
  }

  const tpl = await loadOrderEmailTemplate(offer.brand);
  const ctx = buildOfferMergeCtx(offer, await loadAnredeKunde(offer));
  ctx.eckdaten = await buildEckdatenForOffer(offer);
  const subject = fillMergeTags(tpl.subject, ctx);
  const body    = fillMergeTags(tpl.body, ctx);

  const [{ data: asset }, { data: flyerTpl }, { data: formTpl }] = await Promise.all([
    supabase.from('talentone_brand_assets')
      .select('filename').eq('brand', offer.brand).eq('asset_key', 'offer_flyer').maybeSingle(),
    supabase.from('talentone_offer_templates')
      .select('text').eq('brand', offer.brand).eq('key', 'offer_email_flyer_paragraph').maybeSingle(),
    supabase.from('talentone_offer_templates')
      .select('text').eq('brand', offer.brand).eq('key', 'onboarding_form_url').maybeSingle(),
  ]);
  const flyer_paragraph = fillMergeTags(flyerTpl?.text || '', ctx);

  res.json({
    subject, body,
    to: offer.customer_snapshot?.email || null,
    firma: ctx.firma,
    already_sent: !!offer.order_sent_at,
    sent_to: offer.order_sent_to,
    sent_at: offer.order_sent_at,
    flyer_available: !!asset,
    flyer_filename:  asset?.filename || null,
    flyer_paragraph,
    onboarding_form_url: (formTpl?.text || '').trim() || null,
  });
});

/* POST /api/offers/:id/send-order-email — verschickt die AB per E-Mail.
   PDF wird direkt aus easybill (easybill_order_document_id) gezogen. */
router.post('/:id/send-order-email', async (req, res) => {
  const { to, subject, body, attach_flyer = false } = req.body || {};
  if (!to || !/.+@.+\..+/.test(String(to))) return res.status(400).json({ error: 'Empfänger-E-Mail fehlt oder ungültig.' });
  if (!subject || !String(subject).trim())  return res.status(400).json({ error: 'Betreff fehlt.' });
  if (!body || !String(body).trim())        return res.status(400).json({ error: 'Text fehlt.' });

  try {
    const { data: offer, error } = await supabase
      .from('talentone_offers').select('*').eq('id', req.params.id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!offer) return res.status(404).json({ error: 'Angebot nicht gefunden.' });
    if (!offer.easybill_order_document_id) {
      return res.status(409).json({ error: 'Auftragsbestätigung existiert noch nicht in easybill.' });
    }

    // AB muss finalisiert sein — der Kunde darf nie ein „Entwurf" bekommen.
    try {
      await ensureFinalized(offer.easybill_order_document_id);
    } catch (err) {
      return res.status(502).json({ error: `easybill finalize: ${err.message}` });
    }

    const pdfBuffer = await getDocumentPdf(offer.easybill_order_document_id);
    const firma = (offer.customer_snapshot?.company_name || 'Auftrag').replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 40) || 'Auftrag';
    const pdfFilename = `${firma}_Auftragsbestaetigung.pdf`;

    let flyerBuffer = null, flyerFilename = null, flyerWarn = null;
    if (attach_flyer) {
      try {
        const { data: asset } = await supabase.from('talentone_brand_assets')
          .select('*').eq('brand', offer.brand).eq('asset_key', 'offer_flyer').maybeSingle();
        if (asset) {
          const { downloadFromBucket } = await import('../storage.js');
          flyerBuffer = await downloadFromBucket({ bucket: 'brand-assets', path: asset.storage_path });
          flyerFilename = asset.filename;
        } else {
          flyerWarn = 'Kein Flyer hinterlegt.';
        }
      } catch (err) {
        console.warn('[offers/send-order-email flyer]', err.message);
        flyerWarn = `Flyer nicht ladbar: ${err.message}`;
      }
    }
    const flyerAttached = !!flyerBuffer;

    await sendAuftragMail({
      to, offerBrand: offer.brand, subject, body, pdfBuffer, pdfFilename,
      extraAttachments: flyerAttached ? [{ filename: flyerFilename, content: flyerBuffer }] : [],
    });

    const nowIso = new Date().toISOString();
    const { data: updated, error: upErr } = await supabase
      .from('talentone_offers')
      .update({ order_sent_at: nowIso, order_sent_to: to })
      .eq('id', offer.id).select().single();
    if (upErr) return res.status(500).json({ error: upErr.message });

    if (offer.close_lead_id) {
      const brandLabel = offer.brand === 'nowag_wirth' ? 'Nowag & Wirth' : 'TalentOne';
      closeAddNote({
        leadId: offer.close_lead_id,
        note: `📋 Auftragsbestätigung per E-Mail versendet${flyerAttached ? ' (mit Flyer)' : ''}: ${brandLabel} — an ${to}`,
      }).catch(err => console.warn('[offers/send-order-email close]', err.message));
    }

    res.json({ ok: true, offer: updated, flyer_attached: flyerAttached, flyer_warn: flyerWarn });
  } catch (err) {
    console.error('[offers/send-order-email]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* GET /api/offers/:id/order-pdf — Proxy für AB-PDF-Download. */
router.get('/:id/order-pdf', async (req, res) => {
  try {
    const { data: offer, error } = await supabase
      .from('talentone_offers')
      .select('easybill_order_document_id, customer_snapshot, brand, id')
      .eq('id', req.params.id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!offer) return res.status(404).json({ error: 'Angebot nicht gefunden.' });
    if (!offer.easybill_order_document_id) {
      return res.status(404).json({ error: 'Keine Auftragsbestätigung vorhanden.' });
    }
    const pdf = await getDocumentPdf(offer.easybill_order_document_id);
    const firma = (offer.customer_snapshot?.company_name || 'Auftrag').replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 40) || 'Auftrag';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${firma}_Auftragsbestaetigung.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error('[offers/order-pdf]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* GET /api/offers/sync/status — für UI/Debug. */
router.get('/sync/status', (req, res) => res.json(getOfferSyncStatus()));

/* POST /api/offers/sync — Bulk-Trigger für alle offenen Angebote. */
router.post('/sync', async (req, res) => {
  try {
    const result = await syncOpenOffers();
    res.json({ ok: true, result });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

/* POST /api/offers/:id/resync-easybill — manueller Rücksync-Trigger für ein
   einzelnes Angebot. Idempotent (basiert auf applyAcceptedTransition). */
router.post('/:id/resync-easybill', async (req, res) => {
  try {
    const { data: offer, error } = await supabase
      .from('talentone_offers').select('*').eq('id', req.params.id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!offer) return res.status(404).json({ error: 'Angebot nicht gefunden.' });
    const result = await syncOne(offer);
    res.json({ ok: true, result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* GET /api/offers/config-check — zeigt konfigurierte pdf_template-IDs je
 * (brand, doc-type) und die live von easybill verfügbaren Templates für alle
 * drei relevanten Doc-Typen. Hilft bei White-Label-Setup. */
router.get('/config-check', async (req, res) => {
  try {
    const [offer, invoice, orderConfirm] = await Promise.all([
      listPdfTemplates('OFFER'),
      listPdfTemplates('INVOICE'),
      listPdfTemplates('CHARGE_CONFIRM'),
    ]);
    const mapTpl = t => ({ id: t.id, name: t.name, pdf_template: t.pdf_template });
    res.json({
      configured: getPdfTemplateConfig(),
      available: {
        OFFER:          offer.map(mapTpl),
        INVOICE:        invoice.map(mapTpl),
        CHARGE_CONFIRM: orderConfirm.map(mapTpl),
      },
    });
  } catch (err) {
    res.status(502).json({ error: `easybill: ${err.message}` });
  }
});

/* Lädt aktive Katalog-Positionen einer Marke aus der DB. */
async function loadProductsForBrand(brand) {
  const { data, error } = await supabase
    .from('talentone_offer_products')
    .select('id, sku, brand, category, title, description, unit_price, is_default, sort_order, active')
    .eq('brand', brand)
    .eq('active', true)
    .order('sort_order');
  if (error) throw new Error(error.message);
  return data || [];
}

/* POST /api/offers/calculate
   body: { brand, selected_product_ids:[{product_id, quantity?}], additional_positions_count?, ad_budget_monthly?, vat_rate? }
   → { totals: <calculateOfferTotals-Ergebnis>, brand } */
router.post('/calculate', async (req, res) => {
  const b = req.body || {};
  if (!BRANDS.has(b.brand)) return res.status(400).json({ error: 'brand ungültig.' });
  try {
    // Werbebudget-Validierung — 300..5000 in 50-€-Schritten (nur TalentOne)
    const budgetVal = validateAdBudget(b.ad_budget_monthly);
    if (!budgetVal.ok) return res.status(400).json({ error: budgetVal.error });

    const discountType = ['percent', 'flat'].includes(b.discount_type) ? b.discount_type : null;
    const discountVal  = Number(b.discount_value) || 0;
    const vatRate      = Number.isFinite(+b.vat_rate) ? +b.vat_rate : 19;

    // Snapshot-Pfad (übersteuerte Positionen aus dem Wizard) — sonst Katalog-Pfad.
    if (Array.isArray(b.positionen_snapshot)) {
      const v = validatePositions(b.positionen_snapshot);
      if (!v.ok) return res.status(400).json({ error: v.error });
      const totals = aggregateSnapshot({
        positions: b.positionen_snapshot,
        ad_budget_monthly: b.ad_budget_monthly ?? null,
        vat_rate: vatRate, discount_type: discountType, discount_value: discountVal,
      });
      return res.json({ brand: b.brand, totals });
    }

    const products = await loadProductsForBrand(b.brand);
    const selected = Array.isArray(b.selected_product_ids) ? b.selected_product_ids : [];
    const totals = calculateOfferTotals({
      products, selected,
      additional_positions_count: Number.isFinite(+b.additional_positions_count) ? +b.additional_positions_count : 0,
      ad_budget_monthly: b.ad_budget_monthly ?? null,
      vat_rate: vatRate,
      extra_job_skus: EXTRA_JOB_SKUS_BY_BRAND[b.brand] || [],
      discount_type: discountType,
      discount_value: discountVal,
    });
    res.json({ brand: b.brand, totals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* GET /api/offers?brand=&status=&customer_id=&easybill_customer_id= — Liste
   customer_id: interne UUID des Kunden (talentone_kunden.id) — primäre Quelle
   easybill_customer_id: Fallback, wenn die interne Verknüpfung noch fehlt
   (z.B. bei Angeboten, die vor der ersten Verknüpfung angelegt wurden). */
/* GET /api/offers/resolve-kunde?easybill_customer_id=&email=&company_name=
   Schlägt den passenden internen Kunden vor (für den OfferWizard).
   MUSS vor GET /:id stehen. */
router.get('/resolve-kunde', async (req, res) => {
  const kundeId = await resolveKundeIdForOffer({
    easybill_customer_id: req.query.easybill_customer_id,
    customer_snapshot: { email: req.query.email, company_name: req.query.company_name },
  });
  if (!kundeId) return res.json({ kunde: null });
  const { data: kunde } = await supabase.from('talentone_kunden')
    .select('id, firmenname, email, agentur').eq('id', kundeId).maybeSingle();
  res.json({ kunde: kunde || null });
});

router.get('/', async (req, res) => {
  let q = supabase
    .from('talentone_offers')
    .select('id, brand, customer_id, easybill_customer_id, customer_snapshot, status, setup_total, monthly_total, first_month_total, ad_budget_monthly, vat_rate, easybill_document_id, easybill_order_document_id, easybill_pdf_url, accepted_at, created_at, created_by, sent_at, sent_to, order_sent_at, order_sent_to, campaign_started_at, billing_ended_at, billing_paused_at, billing_pause_reason, billing_external_at, billing_external_note, billing_external_by, guarantee_type, guarantee_period_days, guarantee_applications_count, guarantee_note, hires_target, service_waived_override, decline_note, declined_at, discount_type, discount_value, werbebudget_modus, tagesbudget_empfehlung')
    .order('created_at', { ascending: false });
  if (req.query.brand)  q = q.eq('brand', req.query.brand);
  if (req.query.status) q = q.eq('status', req.query.status);
  if (req.query.customer_id) q = q.eq('customer_id', req.query.customer_id);
  if (req.query.easybill_customer_id) q = q.eq('easybill_customer_id', String(req.query.easybill_customer_id));
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Anreichern: hire_count + billing_phase je Angebot.
  const offers = data || [];
  const acceptedIds = offers.filter(o => o.campaign_started_at).map(o => o.id);
  const hireCounts = {};
  if (acceptedIds.length) {
    const { data: hires } = await supabase
      .from('talentone_hires').select('offer_id')
      .in('offer_id', acceptedIds);
    for (const h of hires || []) hireCounts[h.offer_id] = (hireCounts[h.offer_id] || 0) + 1;
  }
  for (const o of offers) {
    o.hire_count = hireCounts[o.id] || 0;
    o.billing_phase = computeBillingPhase(o);
  }
  res.json({ offers });
});

/** Rein-funktional: bestimmt die Abrechnungs-/Garantie-Phase für die
 *  Liste-UI. Gibt eines von: 'inactive'|'ended'|'paused'|'active'|'guarantee'|'guarantee_expired'
 */
function computeBillingPhase(offer) {
  if (offer.billing_external_at) return 'extern';
  if (offer.billing_ended_at) return 'ended';
  if (offer.billing_paused_at) return 'paused';
  if (!offer.campaign_started_at) return 'inactive';
  const hasHire = (offer.hire_count || 0) > 0;
  if (hasHire) return 'active';
  const start = new Date(offer.campaign_started_at);
  const cutoff = new Date(start.getTime() + (Number(offer.guarantee_period_days) || 30) * 86400000);
  return (new Date()) <= cutoff ? 'guarantee' : 'guarantee_expired';
}

/* POST /api/offers/:id/decline  body: { note: string }
   Setzt Status auf 'declined' + speichert Pflicht-Notiz. Der einzige
   manuelle Statuswechsel — accepted kommt aus dem Rücksync. */
router.post('/:id/decline', async (req, res) => {
  const note = (req.body?.note || '').trim();
  if (!note) return res.status(400).json({ error: 'Notiz ist Pflicht.' });
  const { data: cur } = await supabase.from('talentone_offers').select('status').eq('id', req.params.id).maybeSingle();
  if (!cur) return res.status(404).json({ error: 'Angebot nicht gefunden.' });
  if (cur.status === 'accepted') return res.status(409).json({ error: 'Angenommene Angebote können nicht abgelehnt werden.' });
  const { data, error } = await supabase.from('talentone_offers').update({
    status: 'declined', decline_note: note, declined_at: new Date().toISOString(),
  }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ offer: data });
});

/* GET /api/offers/:id — Einzelnes Angebot */
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('talentone_offers')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Angebot nicht gefunden.' });
  res.json({ offer: data });
});

// Leitet die Garantie-Felder aus dem Request-Body ab — zentrale Stelle fuer
// Create + Patch. guarantee_type steuert OB/WELCHE Garantie; Bewerbungs-Garantie
// ('applications') nur bei TalentOne. `guarantee` ist das Frist-/Billing-Fenster
// in Tagen (0 = keine Garantie -> keine Position).
function resolveGuarantee(b) {
  let type = ['none', 'hire', 'applications'].includes(b.guarantee_type) ? b.guarantee_type : null;
  // Rueckwaertskompatibel: ohne type aus period_days ableiten.
  if (!type) type = Number(b.guarantee_period_days) > 0 ? 'hire' : 'none';
  if (type === 'applications' && b.brand !== 'talentone') type = 'hire';
  const guaranteeType = type;

  let guarantee = 0;
  if (guaranteeType !== 'none') {
    guarantee = b.brand === 'talentone'
      ? 30
      : ([30, 60, 90].includes(Number(b.guarantee_period_days)) ? Number(b.guarantee_period_days) : 30);
  }
  const applicationsCount = guaranteeType === 'applications'
    ? Math.max(1, Math.min(999, Math.round(Number(b.guarantee_applications_count) || 0)))
    : null;
  const guaranteeNote = guaranteeType === 'none'
    ? null
    : (typeof b.guarantee_note === 'string' && b.guarantee_note.trim() ? b.guarantee_note.trim() : null);
  return { guaranteeType, guarantee, applicationsCount, guaranteeNote };
}

/* POST /api/offers  — Draft speichern
   body: {
     brand, easybill_customer_id, customer_snapshot,
     customer_id?, close_lead_id?,
     selected_product_ids, additional_positions_count?, ad_budget_monthly?,
     vat_rate?, status? (default 'draft')
   }
   Serverseitige Neuberechnung — verhindert Manipulation der Summen im Frontend.
*/
router.post('/', async (req, res) => {
  const b = req.body || {};
  if (!BRANDS.has(b.brand)) return res.status(400).json({ error: 'brand ungültig.' });
  if (!b.easybill_customer_id) return res.status(400).json({ error: 'easybill_customer_id ist Pflicht.' });

  try {
    const products = await loadProductsForBrand(b.brand);
    const selected = Array.isArray(b.selected_product_ids) ? b.selected_product_ids : [];
    const budgetVal = validateAdBudget(b.ad_budget_monthly);
    if (!budgetVal.ok) return res.status(400).json({ error: budgetVal.error });

    // Rabatt bereits im create validieren, damit calc + Storage konsistent sind.
    const discountType = ['percent', 'flat'].includes(b.discount_type) ? b.discount_type : null;
    const discountVal  = Number(b.discount_value) || 0;

    // Werbebudget-Modus: 'empfehlung' -> nicht abgerechnet (Budget aus der
    // Kalkulation genommen), stattdessen nur ein Hinweis + Tagesbudget-Empfehlung.
    const werbebudgetModus = b.werbebudget_modus === 'empfehlung' ? 'empfehlung' : 'position';
    const tagesbudget = werbebudgetModus === 'empfehlung' ? (Number(b.tagesbudget_empfehlung) || null) : null;

    const addCountPost = Number.isFinite(+b.additional_positions_count) ? +b.additional_positions_count : 0;
    const vatRatePost  = Number.isFinite(+b.vat_rate) ? +b.vat_rate : 19;
    const adBudgetForCalc = werbebudgetModus === 'empfehlung' ? null : (b.ad_budget_monthly ?? null);

    // Positions-Snapshot: aus dem Wizard übersteuerte Positionen (falls
    // mitgeschickt) — sonst aus dem Katalog abgeleitet. In beiden Fällen wird der
    // Snapshot gespeichert, damit Downstream nie erneut auf den Katalog angewiesen ist.
    let totals, positionsSnapshot;
    if (Array.isArray(b.positionen_snapshot)) {
      const v = validatePositions(b.positionen_snapshot);
      if (!v.ok) return res.status(400).json({ error: v.error });
      totals = aggregateSnapshot({
        positions: b.positionen_snapshot,
        ad_budget_monthly: adBudgetForCalc, vat_rate: vatRatePost,
        discount_type: discountType, discount_value: discountVal,
      });
      positionsSnapshot = totals.positions;
    } else {
      totals = calculateOfferTotals({
        products, selected,
        additional_positions_count: addCountPost,
        ad_budget_monthly: adBudgetForCalc,
        vat_rate: vatRatePost,
        extra_job_skus: EXTRA_JOB_SKUS_BY_BRAND[b.brand] || [],
        discount_type: discountType,
        discount_value: discountVal,
      });
      positionsSnapshot = resolveOfferPositions(
        { brand: b.brand, selected_product_ids: selected, additional_positions_count: addCountPost, vat_rate: vatRatePost },
        products,
      );
    }

    // Garantie-Art (explizit): none | hire | applications. Steuert OB + WELCHE
    // Garantie-Position erscheint. Bewerbungs-Garantie nur bei TalentOne.
    const { guaranteeType, guarantee, applicationsCount, guaranteeNote } = resolveGuarantee(b);
    const hiresTarget = Number.isFinite(+b.hires_target)
      ? Math.max(1, Math.min(10, Math.round(+b.hires_target)))
      : 1;

    // Auto-Verknüpfung mit internem Kunden (gehärtet): expliziter customer_id →
    // easybill-Cache-Email → Snapshot-Email → Snapshot-Firmenname (case-insensitiv).
    // So bleiben Angebote seltener "verwaist".
    const resolvedCustomerId = await resolveKundeIdForOffer({
      customer_id: b.customer_id,
      easybill_customer_id: b.easybill_customer_id,
      customer_snapshot: b.customer_snapshot,
    });

    const row = {
      brand:                       b.brand,
      customer_id:                 resolvedCustomerId,
      easybill_customer_id:        String(b.easybill_customer_id),
      customer_snapshot:           b.customer_snapshot || {},
      close_lead_id:               b.close_lead_id || null,
      selected_product_ids:        Array.isArray(b.selected_product_ids) ? b.selected_product_ids : [],
      positions_snapshot:          positionsSnapshot,
      ad_budget_monthly:           totals.ad_budget_monthly || null,
      additional_positions_count:  addCountPost,
      setup_total:                 totals.setup_total,
      monthly_total:               totals.monthly_total,
      first_month_total:           totals.first_month_total,
      vat_rate:                    totals.vat_rate,
      status:                      b.status === 'draft' ? 'draft' : 'draft',
      guarantee_type:              guaranteeType,
      guarantee_period_days:       guarantee,
      guarantee_applications_count: applicationsCount,
      guarantee_note:              guaranteeNote,
      discount_type:               totals.discount_type,
      discount_value:              totals.discount_value,
      hires_target:                hiresTarget,
      werbebudget_modus:           werbebudgetModus,
      tagesbudget_empfehlung:      tagesbudget,
      created_by:                  req.user?.email || null,
    };

    const { data, error } = await supabase
      .from('talentone_offers')
      .insert(row)
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ offer: data, totals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* PATCH /api/offers/:id  — Draft aktualisieren, Summen neu berechnen. */
router.patch('/:id', async (req, res) => {
  const b = req.body || {};
  try {
    const { data: cur, error: eGet } = await supabase
      .from('talentone_offers').select('*').eq('id', req.params.id).maybeSingle();
    if (eGet) return res.status(500).json({ error: eGet.message });
    if (!cur) return res.status(404).json({ error: 'Angebot nicht gefunden.' });
    if (cur.status !== 'draft') return res.status(409).json({ error: 'Nur Drafts sind editierbar.' });

    const brand = b.brand && BRANDS.has(b.brand) ? b.brand : cur.brand;
    const selected = Array.isArray(b.selected_product_ids) ? b.selected_product_ids : cur.selected_product_ids || [];
    const addCount = Number.isFinite(+b.additional_positions_count) ? +b.additional_positions_count : (cur.additional_positions_count || 0);
    const adBudget = b.ad_budget_monthly !== undefined ? b.ad_budget_monthly : cur.ad_budget_monthly;
    const vatRate  = Number.isFinite(+b.vat_rate) ? +b.vat_rate : Number(cur.vat_rate);

    const products = await loadProductsForBrand(brand);
    const budgetVal = validateAdBudget(adBudget);
    if (!budgetVal.ok) return res.status(400).json({ error: budgetVal.error });

    // Rabatt: neuer Wert falls im Patch, sonst aus Current uebernehmen (damit Summe stimmt).
    const discountType = b.discount_type !== undefined
      ? (['percent', 'flat'].includes(b.discount_type) ? b.discount_type : null)
      : (cur.discount_type || null);
    const discountVal = b.discount_value !== undefined
      ? (Number(b.discount_value) || 0)
      : (Number(cur.discount_value) || 0);

    const werbebudgetModus = b.werbebudget_modus !== undefined
      ? (b.werbebudget_modus === 'empfehlung' ? 'empfehlung' : 'position')
      : (cur.werbebudget_modus || 'position');
    const tagesbudget = werbebudgetModus === 'empfehlung'
      ? (b.tagesbudget_empfehlung !== undefined ? (Number(b.tagesbudget_empfehlung) || null) : (cur.tagesbudget_empfehlung ?? null))
      : null;

    const adBudgetForCalc = werbebudgetModus === 'empfehlung' ? null : adBudget;

    // Snapshot: übersteuerte Positionen aus dem Body (falls vorhanden) — sonst
    // aus dem Katalog abgeleitet (Selektion/Menge des Drafts).
    let totals, positionsSnapshot;
    if (Array.isArray(b.positionen_snapshot)) {
      const v = validatePositions(b.positionen_snapshot);
      if (!v.ok) return res.status(400).json({ error: v.error });
      totals = aggregateSnapshot({
        positions: b.positionen_snapshot,
        ad_budget_monthly: adBudgetForCalc, vat_rate: vatRate,
        discount_type: discountType, discount_value: discountVal,
      });
      positionsSnapshot = totals.positions;
    } else {
      totals = calculateOfferTotals({
        products, selected,
        additional_positions_count: addCount,
        ad_budget_monthly: adBudgetForCalc,
        vat_rate: vatRate,
        extra_job_skus: EXTRA_JOB_SKUS_BY_BRAND[brand] || [],
        discount_type: discountType,
        discount_value: discountVal,
      });
      positionsSnapshot = resolveOfferPositions(
        { brand, selected_product_ids: selected, additional_positions_count: addCount, vat_rate: vatRate },
        products,
      );
    }

    const patch = {
      brand,
      selected_product_ids:        selected,
      positions_snapshot:          positionsSnapshot,
      additional_positions_count:  addCount,
      ad_budget_monthly:           totals.ad_budget_monthly || null,
      setup_total:                 totals.setup_total,
      monthly_total:               totals.monthly_total,
      first_month_total:           totals.first_month_total,
      vat_rate:                    totals.vat_rate,
      discount_type:               totals.discount_type,
      discount_value:              totals.discount_value,
      werbebudget_modus:           werbebudgetModus,
      tagesbudget_empfehlung:      tagesbudget,
    };
    if (b.customer_id !== undefined)          patch.customer_id = b.customer_id || null;
    if (b.easybill_customer_id !== undefined) patch.easybill_customer_id = String(b.easybill_customer_id);
    if (b.customer_snapshot !== undefined)    patch.customer_snapshot = b.customer_snapshot;
    if (b.close_lead_id !== undefined)        patch.close_lead_id = b.close_lead_id || null;
    // Garantie: wird als Einheit neu abgeleitet, sobald eine Garantie-Angabe im
    // Body ist (Art/Frist/Anzahl/Text) — so bleiben Art, Frist und Text konsistent.
    if (b.guarantee_type !== undefined || b.guarantee_period_days !== undefined
        || b.guarantee_applications_count !== undefined || b.guarantee_note !== undefined) {
      const g = resolveGuarantee({ ...b, brand });
      patch.guarantee_type = g.guaranteeType;
      patch.guarantee_period_days = g.guarantee;
      patch.guarantee_applications_count = g.applicationsCount;
      patch.guarantee_note = g.guaranteeNote;
    }
    if (b.hires_target !== undefined) {
      const raw = Number(b.hires_target);
      patch.hires_target = Number.isFinite(raw) ? Math.max(1, Math.min(10, Math.round(raw))) : 1;
    }

    const { data, error } = await supabase
      .from('talentone_offers')
      .update(patch)
      .eq('id', req.params.id)
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ offer: data, totals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Preflight: prueft ob der finale Garantie-Text (aus offer.guarantee_note
 * ODER template guarantee) unser Nicht-Versprechen verletzt — sprich eine
 * Bewerbungsanzahl zusichert. Unsere Garantie ist "kostenlose Weiterarbeit
 * bis zur Einstellung", NIE eine Bewerbungszahl.
 *
 * @returns {null|{issue:string,message:string,sample:string}} null wenn ok
 */
function checkGuaranteeWarning({ offer, templateText }) {
  if (!offer || Number(offer.guarantee_period_days || 0) <= 0) return null;
  // Bewerbungs-Garantie ist eine bewusste, explizit gewaehlte Zusage — hier ist
  // eine Bewerbungsanzahl gewollt, also kein Preflight-Warnhinweis.
  if (offer.guarantee_type === 'applications') return null;
  const text = (offer.guarantee_note && offer.guarantee_note.trim())
    || templateText
    || '';
  if (!text) return null;
  // Trigger-Muster: "X Bewerbungen", "[X] Bewerbungen", "garantiert...bewerbung"
  const patterns = [
    /\d+\s*(qualifizierte\s+)?bewerbunge?n/i,
    /\[?\s*x\s*\]?\s*(qualifizierte\s+)?bewerbunge?n/i,
    /bewerbungsanzahl|anzahl\s+bewerbungen/i,
    /bewerbungen\s+garantiert|garantierte?\s+(anzahl\s+)?bewerbungen/i,
  ];
  const match = patterns.find(r => r.test(text));
  if (!match) return null;
  return {
    issue: 'guarantee_bewerbungen',
    message: 'Die Garantie-Formulierung verspricht eine Bewerbungsanzahl. Unsere Garantie bezieht sich auf kostenlose Weiterarbeit bis zur ersten Einstellung — nicht auf Bewerbungszahlen.',
    sample: text.match(/.{0,80}(bewerbungs?anzahl|\d+\s*(qualifizierte\s+)?bewerbunge?n|\[?\s*x\s*\]?\s*bewerbunge?n|garantierte?\s+(anzahl\s+)?bewerbungen)[^\n\.]{0,80}/i)?.[0]?.trim()
      || text.slice(0, 160),
  };
}

/* POST /api/offers/:id/create-easybill
   Nimmt einen Draft, baut das easybill-Payload deterministisch (serverseitige
   Neuberechnung — Frontend kann Summen nicht manipulieren), sendet an
   POST /documents, speichert doc_id + pdf_url + status='created'.
   Draft bleibt bei Fehler unverändert (Status draft).
*/
router.post('/:id/create-easybill', async (req, res) => {
  try {
    const { data: offer, error } = await supabase
      .from('talentone_offers').select('*').eq('id', req.params.id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!offer) return res.status(404).json({ error: 'Angebot nicht gefunden.' });
    if (offer.status !== 'draft') {
      return res.status(409).json({ error: `Nur Drafts können erzeugt werden (aktuell: ${offer.status}).` });
    }
    if (!offer.easybill_customer_id) {
      return res.status(400).json({ error: 'Kunde ohne easybill_customer_id — Draft ist inkonsistent.' });
    }

    // Katalog + Textbausteine der Marke laden
    const [{ data: products }, { data: templates }] = await Promise.all([
      supabase.from('talentone_offer_products').select('*').eq('brand', offer.brand).eq('active', true),
      supabase.from('talentone_offer_templates').select('key, text').eq('brand', offer.brand),
    ]);

    // Preflight: Garantie-Text darf keine Bewerbungsanzahl versprechen.
    const guaranteeTpl = (templates || []).find(t => t.key === 'guarantee')?.text || null;
    const gWarn = checkGuaranteeWarning({ offer, templateText: guaranteeTpl });
    if (gWarn && !req.body?.confirm_guarantee_warning) {
      return res.status(409).json({ error: gWarn.message, warning: gWarn.issue, sample: gWarn.sample });
    }

    // Positionen aus dem Snapshot (übersteuerte Werte); Alt-Angebote → Katalog.
    const positions = resolveOfferPositions(offer, products || []);
    const vPos = validatePositions(positions);
    if (!vPos.ok) return res.status(400).json({ error: vPos.error });

    // Payload deterministisch bauen — Summen recomputed, kein Trust auf DB-Werte
    const { items } = buildEasybillOfferPayload({
      brand: offer.brand,
      products: products || [],
      positions,
      ad_budget_monthly: offer.ad_budget_monthly,
      vat_rate: Number(offer.vat_rate) || 19,
      templates: templates || [],
      discount_type: offer.discount_type || null,
      discount_value: Number(offer.discount_value) || 0,
      guarantee_type: offer.guarantee_type || null,
      guarantee_period_days: Number(offer.guarantee_period_days) || 0,
      guarantee_applications_count: offer.guarantee_applications_count ?? null,
      guarantee_note: offer.guarantee_note || null,
      werbebudget_modus: offer.werbebudget_modus || 'position',
      tagesbudget_empfehlung: offer.tagesbudget_empfehlung ?? null,
    });

    if (!items.length) return res.status(400).json({ error: 'Keine Positionen im Angebot.' });

    // easybill Kundenname aus Snapshot für den Titel
    const snap = offer.customer_snapshot || {};
    const kundenname = snap.company_name || 'Angebot';
    const title = `Angebot für ${kundenname}`.slice(0, 200);

    let document;
    try {
      document = await createOffer({
        customerId:  Number(offer.easybill_customer_id),
        title,
        items,
        pdfTemplate: getPdfTemplate(offer.brand, 'OFFER'),
        externalId:  offer.id, // Rücksync-Anker für Phase 4
      });
    } catch (err) {
      // easybill-Fehler → Draft bleibt bestehen, sauber ins UI zurück
      return res.status(502).json({ error: `easybill: ${err.message}` });
    }

    // Erfolg: doc-id + pdf-url speichern, Status auf 'created'
    const pdfUrl = `/api/offers/${offer.id}/pdf`; // interner Proxy — extern nicht direkt easybill
    const { data: updated, error: updErr } = await supabase
      .from('talentone_offers')
      .update({
        status: 'created',
        easybill_document_id: String(document.id),
        easybill_pdf_url: pdfUrl,
        last_synced_at: new Date().toISOString(),
      })
      .eq('id', offer.id).select().single();
    if (updErr) return res.status(500).json({ error: updErr.message, easybill_document_id: document.id });

    res.status(201).json({ offer: updated, easybill: { id: document.id, number: document.number } });
  } catch (err) {
    console.error('[offers/create-easybill]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* POST /api/offers/:id/create-easybill-order
   Direkt-Auftragsbestätigung — für den Fall, dass der Auftrag im Gespräch
   mündlich abgeschlossen wurde. Es wird KEIN Angebot erzeugt, sondern
   sofort ein CHARGE_CONFIRM in easybill. Offer.status = 'accepted',
   easybill_order_document_id gesetzt, easybill_document_id bleibt NULL.
   Der Rücksync ignoriert Rows ohne easybill_document_id ohnehin.
*/
router.post('/:id/create-easybill-order', async (req, res) => {
  try {
    const { data: offer, error } = await supabase
      .from('talentone_offers').select('*').eq('id', req.params.id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!offer) return res.status(404).json({ error: 'Angebot nicht gefunden.' });
    // Aus Entwurf ODER einem bereits versendeten Angebot (created/sent) heraus:
    // erzeugt eine AB (CHARGE_CONFIRM) und setzt das Angebot auf 'accepted'.
    if (!['draft', 'created', 'sent'].includes(offer.status)) {
      return res.status(409).json({ error: `Aus diesem Status kann keine Auftragsbestätigung erzeugt werden (aktuell: ${offer.status}).` });
    }
    if (!offer.easybill_customer_id) {
      return res.status(400).json({ error: 'Kunde ohne easybill_customer_id — Angebot ist inkonsistent.' });
    }

    const [{ data: products }, { data: templates }] = await Promise.all([
      supabase.from('talentone_offer_products').select('*').eq('brand', offer.brand).eq('active', true),
      supabase.from('talentone_offer_templates').select('key, text').eq('brand', offer.brand),
    ]);

    // Preflight (Direkt-AB): Garantie-Text darf keine Bewerbungsanzahl versprechen.
    const guaranteeTplAb = (templates || []).find(t => t.key === 'guarantee')?.text || null;
    const gWarnAb = checkGuaranteeWarning({ offer, templateText: guaranteeTplAb });
    if (gWarnAb && !req.body?.confirm_guarantee_warning) {
      return res.status(409).json({ error: gWarnAb.message, warning: gWarnAb.issue, sample: gWarnAb.sample });
    }

    const positions = resolveOfferPositions(offer, products || []);
    const vPos = validatePositions(positions);
    if (!vPos.ok) return res.status(400).json({ error: vPos.error });

    const { items } = buildEasybillOfferPayload({
      brand: offer.brand,
      products: products || [],
      positions,
      ad_budget_monthly: offer.ad_budget_monthly,
      vat_rate: Number(offer.vat_rate) || 19,
      templates: templates || [],
      discount_type: offer.discount_type || null,
      discount_value: Number(offer.discount_value) || 0,
      guarantee_type: offer.guarantee_type || null,
      guarantee_period_days: Number(offer.guarantee_period_days) || 0,
      guarantee_applications_count: offer.guarantee_applications_count ?? null,
      guarantee_note: offer.guarantee_note || null,
      werbebudget_modus: offer.werbebudget_modus || 'position',
      tagesbudget_empfehlung: offer.tagesbudget_empfehlung ?? null,
    });
    if (!items.length) return res.status(400).json({ error: 'Keine Positionen im Angebot.' });

    const snap = offer.customer_snapshot || {};
    const kundenname = snap.company_name || 'Auftrag';
    const title = `Auftragsbestätigung für ${kundenname}`.slice(0, 200);

    let document;
    try {
      document = await createChargeConfirm({
        customerId:  Number(offer.easybill_customer_id),
        title,
        items,
        pdfTemplate: getPdfTemplate(offer.brand, 'CHARGE_CONFIRM'),
        externalId:  offer.id,
      });
    } catch (err) {
      return res.status(502).json({ error: `easybill: ${err.message}` });
    }

    // AB finalisieren — sonst „Entwurf"-Wasserzeichen und keine Nummer.
    try {
      const { doc: finalDoc } = await ensureFinalized(document.id);
      if (finalDoc) document = finalDoc;
    } catch (err) {
      return res.status(502).json({
        error: `easybill finalize: ${err.message}`,
        easybill_order_document_id: document.id,
      });
    }

    const nowIso = new Date().toISOString();
    const { data: updated, error: updErr } = await supabase
      .from('talentone_offers')
      .update({
        status: 'accepted',
        accepted_at: nowIso,
        easybill_order_document_id: String(document.id),
        // easybill_document_id BLEIBT NULL — Marker für den Direkt-AB-Fall
        last_synced_at: nowIso,
      })
      .eq('id', offer.id).select().single();
    if (updErr) return res.status(500).json({ error: updErr.message, easybill_order_document_id: document.id });

    // Close-Notiz best-effort — nie den Endpoint blockieren.
    if (updated.close_lead_id) {
      const brandLabel = offer.brand === 'nowag_wirth' ? 'Nowag & Wirth' : 'TalentOne';
      const monat1 = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
        .format(Number(offer.first_month_total) || 0);
      const abNumber = document.number ? `AB ${document.number}` : `Doc ${document.id}`;
      const note = `✅ Direktauftrag angenommen: ${brandLabel} — ${abNumber} — Monat 1: ${monat1}`;
      closeAddNote({ leadId: updated.close_lead_id, note })
        .catch(err => console.warn('[offers/create-easybill-order close-note]', err.message));
    }

    // Projekt-Card auto-anlegen (idempotent)
    ensureProjektForOffer(updated)
      .then(res => { if (res.created) console.log(`[offers/create-easybill-order] Projekt ${res.projekt.id} angelegt`); })
      .catch(err => console.warn('[offers/create-easybill-order projekt-automation]', err.message));

    res.status(201).json({ offer: updated, easybill: { id: document.id, number: document.number } });
  } catch (err) {
    console.error('[offers/create-easybill-order]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* POST /api/offers/:id/mark-accepted
   Manuell als angenommen markieren — OHNE eine AB in easybill zu erzeugen
   (z.B. wenn der Auftrag mündlich bestätigt oder direkt in easybill abgewickelt
   wurde). Setzt status='accepted' + accepted_at, legt Projekt-Card an, notiert in
   Close. Danach greifen Abrechnung + „extern abgerechnet". */
router.post('/:id/mark-accepted', async (req, res) => {
  try {
    const { data: offer, error } = await supabase
      .from('talentone_offers').select('*').eq('id', req.params.id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!offer) return res.status(404).json({ error: 'Angebot nicht gefunden.' });
    if (offer.status === 'accepted') return res.status(409).json({ error: 'Angebot ist bereits als angenommen markiert.' });
    if (offer.status === 'declined') return res.status(409).json({ error: 'Ein abgelehntes Angebot kann nicht angenommen werden.' });

    const nowIso = new Date().toISOString();
    const { data: updated, error: updErr } = await supabase
      .from('talentone_offers')
      .update({ status: 'accepted', accepted_at: nowIso, last_synced_at: nowIso })
      .eq('id', offer.id).select().single();
    if (updErr) return res.status(500).json({ error: updErr.message });

    if (updated.close_lead_id) {
      const brandLabel = offer.brand === 'nowag_wirth' ? 'Nowag & Wirth' : 'TalentOne';
      const monat1 = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(offer.first_month_total) || 0);
      closeAddNote({ leadId: updated.close_lead_id, note: `✅ Angebot manuell als angenommen markiert: ${brandLabel} — Monat 1: ${monat1}` })
        .catch(err => console.warn('[offers/mark-accepted close-note]', err.message));
    }
    ensureProjektForOffer(updated)
      .then(r => { if (r.created) console.log(`[offers/mark-accepted] Projekt ${r.projekt.id} angelegt`); })
      .catch(err => console.warn('[offers/mark-accepted projekt-automation]', err.message));

    res.json({ offer: updated });
  } catch (err) {
    console.error('[offers/mark-accepted]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* GET /api/offers/:id/pdf — Proxy für PDF-Download von easybill.
   Der Bearer-API-Key bleibt serverseitig, das PDF wird durchgereicht. */
router.get('/:id/pdf', async (req, res) => {
  try {
    const { data: offer, error } = await supabase
      .from('talentone_offers').select('easybill_document_id, customer_snapshot, brand, id')
      .eq('id', req.params.id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!offer) return res.status(404).json({ error: 'Angebot nicht gefunden.' });
    if (!offer.easybill_document_id) {
      return res.status(409).json({ error: 'Angebot wurde noch nicht in easybill erzeugt.' });
    }
    const pdf = await getDocumentPdf(offer.easybill_document_id);
    const firma = (offer.customer_snapshot?.company_name || 'Angebot').replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 40) || 'Angebot';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${firma}_Angebot.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error('[offers/pdf]', err.message);
    res.status(502).json({ error: `easybill: ${err.message}` });
  }
});

/* DELETE /api/offers/:id — nur Drafts löschbar. */
router.delete('/:id', async (req, res) => {
  const { data: cur } = await supabase
    .from('talentone_offers')
    .select('status, easybill_document_id, easybill_order_document_id')
    .eq('id', req.params.id).maybeSingle();
  if (!cur) return res.status(404).json({ error: 'Angebot nicht gefunden.' });
  // Angenommene Angebote sind verbindlich (Kunde hat unterschrieben) — nicht löschbar.
  if (cur.status === 'accepted') {
    return res.status(409).json({ error: 'Angenommene Angebote können nicht gelöscht werden.' });
  }
  const { error } = await supabase.from('talentone_offers').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  // Ein evtl. schon erzeugter easybill-Beleg bleibt in easybill bestehen (wird
  // nicht automatisch gelöscht) — Hinweis für die UI.
  const easybillBeleg = cur.easybill_document_id || cur.easybill_order_document_id
    ? 'Der zugehörige easybill-Beleg bleibt in easybill bestehen und muss dort ggf. separat storniert/gelöscht werden.'
    : null;
  res.json({ ok: true, hinweis: easybillBeleg });
});

/* POST /api/offers/:id/link-customer  body: { customer_id }
   Ordnet ein (verwaistes) Angebot einem internen Kunden zu — inkl. der
   verwaisten Rechnungen des Angebots. */
router.post('/:id/link-customer', async (req, res) => {
  const kundeId = req.body?.customer_id;
  if (!kundeId) return res.status(400).json({ error: 'customer_id ist Pflicht.' });
  const { data: kunde } = await supabase.from('talentone_kunden').select('id').eq('id', kundeId).maybeSingle();
  if (!kunde) return res.status(404).json({ error: 'Kunde nicht gefunden.' });
  try {
    const offer = await linkOfferToKunde(req.params.id, kundeId);
    res.json({ offer });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
