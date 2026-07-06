// Angebote (talentone_offers): Live-Berechnung, Draft-CRUD, Liste.
// Die easybill-Erzeugung folgt in Phase 3.

import { Router } from 'express';
import { supabase } from '../supabase.js';
import { calculateOfferTotals } from '../offer-calc.js';
import { buildEasybillOfferPayload } from '../offer-easybill-builder.js';
import { createOffer, getDocument, getDocumentPdf, listPdfTemplates } from '../easybill.js';
import { getPdfTemplate, getPdfTemplateConfig } from '../easybill-templates.js';

const router = Router();

const BRANDS = new Set(['talentone', 'nowag_wirth']);
const EXTRA_JOB_SKU_BY_BRAND = { talentone: 'TO-OPT-EXTRA-JOB', nowag_wirth: 'NW-OPT-EXTRA-JOB' };

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
    const products = await loadProductsForBrand(b.brand);
    const totals = calculateOfferTotals({
      products,
      selected: Array.isArray(b.selected_product_ids) ? b.selected_product_ids : [],
      additional_positions_count: Number.isFinite(+b.additional_positions_count) ? +b.additional_positions_count : 0,
      ad_budget_monthly: b.ad_budget_monthly ?? null,
      vat_rate: Number.isFinite(+b.vat_rate) ? +b.vat_rate : 19,
      extra_job_sku: EXTRA_JOB_SKU_BY_BRAND[b.brand] || null,
    });
    res.json({ brand: b.brand, totals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* GET /api/offers?brand=&status= — Liste */
router.get('/', async (req, res) => {
  let q = supabase
    .from('talentone_offers')
    .select('id, brand, customer_id, easybill_customer_id, customer_snapshot, status, setup_total, monthly_total, first_month_total, ad_budget_monthly, vat_rate, easybill_document_id, easybill_pdf_url, accepted_at, created_at, created_by')
    .order('created_at', { ascending: false });
  if (req.query.brand)  q = q.eq('brand', req.query.brand);
  if (req.query.status) q = q.eq('status', req.query.status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ offers: data || [] });
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
    const totals = calculateOfferTotals({
      products,
      selected: Array.isArray(b.selected_product_ids) ? b.selected_product_ids : [],
      additional_positions_count: Number.isFinite(+b.additional_positions_count) ? +b.additional_positions_count : 0,
      ad_budget_monthly: b.ad_budget_monthly ?? null,
      vat_rate: Number.isFinite(+b.vat_rate) ? +b.vat_rate : 19,
      extra_job_sku: EXTRA_JOB_SKU_BY_BRAND[b.brand] || null,
    });

    const row = {
      brand:                       b.brand,
      customer_id:                 b.customer_id || null,
      easybill_customer_id:        String(b.easybill_customer_id),
      customer_snapshot:           b.customer_snapshot || {},
      close_lead_id:               b.close_lead_id || null,
      selected_product_ids:        Array.isArray(b.selected_product_ids) ? b.selected_product_ids : [],
      ad_budget_monthly:           totals.ad_budget_monthly || null,
      additional_positions_count:  Number.isFinite(+b.additional_positions_count) ? +b.additional_positions_count : 0,
      setup_total:                 totals.setup_total,
      monthly_total:               totals.monthly_total,
      first_month_total:           totals.first_month_total,
      vat_rate:                    totals.vat_rate,
      status:                      b.status === 'draft' ? 'draft' : 'draft',   // Phase 2: nur Draft
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
    const totals = calculateOfferTotals({
      products,
      selected,
      additional_positions_count: addCount,
      ad_budget_monthly: adBudget,
      vat_rate: vatRate,
      extra_job_sku: EXTRA_JOB_SKU_BY_BRAND[brand] || null,
    });

    const patch = {
      brand,
      selected_product_ids:        selected,
      additional_positions_count:  addCount,
      ad_budget_monthly:           totals.ad_budget_monthly || null,
      setup_total:                 totals.setup_total,
      monthly_total:               totals.monthly_total,
      first_month_total:           totals.first_month_total,
      vat_rate:                    totals.vat_rate,
    };
    if (b.customer_id !== undefined)          patch.customer_id = b.customer_id || null;
    if (b.easybill_customer_id !== undefined) patch.easybill_customer_id = String(b.easybill_customer_id);
    if (b.customer_snapshot !== undefined)    patch.customer_snapshot = b.customer_snapshot;
    if (b.close_lead_id !== undefined)        patch.close_lead_id = b.close_lead_id || null;

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

    // Payload deterministisch bauen — Summen recomputed, kein Trust auf DB-Werte
    const { items } = buildEasybillOfferPayload({
      brand: offer.brand,
      products: products || [],
      selected: Array.isArray(offer.selected_product_ids) ? offer.selected_product_ids : [],
      additional_positions_count: offer.additional_positions_count || 0,
      ad_budget_monthly: offer.ad_budget_monthly,
      vat_rate: Number(offer.vat_rate) || 19,
      templates: templates || [],
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
    .from('talentone_offers').select('status').eq('id', req.params.id).maybeSingle();
  if (!cur) return res.status(404).json({ error: 'Angebot nicht gefunden.' });
  if (cur.status !== 'draft') return res.status(409).json({ error: 'Nur Drafts können gelöscht werden.' });
  const { error } = await supabase.from('talentone_offers').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

export default router;
