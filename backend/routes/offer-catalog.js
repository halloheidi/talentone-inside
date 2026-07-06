// Angebots-Katalog (Phase 1 des Angebots-/Abrechnungs-Systems)
// - Positionskatalog: talentone_offer_products
// - Textbausteine:    talentone_offer_templates
//
// Alle Endpoints erfordern requireAuth (im server.js gemountet).
// Mutationen (POST/PATCH) zusätzlich requireAdmin — nur Whitelist aus team.js.

import { Router } from 'express';
import { supabase } from '../supabase.js';
import { requireAdmin } from '../auth.js';

const router = Router();

const BRANDS = new Set(['talentone', 'nowag_wirth']);
const CATEGORIES = new Set(['setup', 'monthly', 'option_setup', 'option_monthly']);

// ─────────────────────────── Products ───────────────────────────

/* GET /api/offer-catalog/products?brand=talentone|nowag_wirth&include_inactive=1 */
router.get('/products', async (req, res) => {
  const { brand, include_inactive } = req.query || {};
  let q = supabase.from('talentone_offer_products').select('*');
  if (brand) {
    if (!BRANDS.has(brand)) return res.status(400).json({ error: 'Ungültige brand.' });
    q = q.eq('brand', brand);
  }
  if (!include_inactive) q = q.eq('active', true);
  q = q.order('brand').order('sort_order').order('title');
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ products: data || [] });
});

/* POST /api/offer-catalog/products
   body: { brand, category, sku, title, description?, unit_price?, is_default?, sort_order?, active? } */
router.post('/products', requireAdmin, async (req, res) => {
  const b = req.body || {};
  if (!BRANDS.has(b.brand))       return res.status(400).json({ error: 'brand fehlt/ungültig.' });
  if (!CATEGORIES.has(b.category)) return res.status(400).json({ error: 'category fehlt/ungültig.' });
  if (!b.sku || typeof b.sku !== 'string') return res.status(400).json({ error: 'sku ist Pflicht.' });
  if (!b.title || typeof b.title !== 'string') return res.status(400).json({ error: 'title ist Pflicht.' });

  const row = {
    brand:       b.brand,
    category:    b.category,
    sku:         String(b.sku).trim(),
    title:       String(b.title).trim(),
    description: typeof b.description === 'string' ? b.description : '',
    unit_price:  Number.isFinite(+b.unit_price) ? +b.unit_price : 0,
    is_default:  !!b.is_default,
    sort_order:  Number.isFinite(+b.sort_order) ? Math.round(+b.sort_order) : 0,
    active:      b.active === undefined ? true : !!b.active,
  };

  const { data, error } = await supabase
    .from('talentone_offer_products')
    .insert(row)
    .select().single();
  if (error) {
    if (String(error.message).includes('duplicate key')) {
      return res.status(409).json({ error: 'SKU existiert bereits.' });
    }
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json({ product: data });
});

/* PATCH /api/offer-catalog/products/:id
   body: beliebige Untermenge der schreibbaren Felder */
router.patch('/products/:id', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const patch = {};

  if (b.brand !== undefined) {
    if (!BRANDS.has(b.brand)) return res.status(400).json({ error: 'brand ungültig.' });
    patch.brand = b.brand;
  }
  if (b.category !== undefined) {
    if (!CATEGORIES.has(b.category)) return res.status(400).json({ error: 'category ungültig.' });
    patch.category = b.category;
  }
  if (b.sku !== undefined)         patch.sku = String(b.sku).trim();
  if (b.title !== undefined)       patch.title = String(b.title).trim();
  if (b.description !== undefined) patch.description = typeof b.description === 'string' ? b.description : '';
  if (b.unit_price !== undefined)  patch.unit_price = Number.isFinite(+b.unit_price) ? +b.unit_price : 0;
  if (b.is_default !== undefined)  patch.is_default = !!b.is_default;
  if (b.sort_order !== undefined)  patch.sort_order = Number.isFinite(+b.sort_order) ? Math.round(+b.sort_order) : 0;
  if (b.active !== undefined)      patch.active = !!b.active;

  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Keine Änderungen übergeben.' });

  const { data, error } = await supabase
    .from('talentone_offer_products')
    .update(patch)
    .eq('id', req.params.id)
    .select().single();
  if (error) {
    if (String(error.message).includes('duplicate key')) {
      return res.status(409).json({ error: 'SKU existiert bereits.' });
    }
    return res.status(500).json({ error: error.message });
  }
  if (!data) return res.status(404).json({ error: 'Position nicht gefunden.' });
  res.json({ product: data });
});

// Hinweis: kein DELETE — Positionen werden nur deaktiviert (active=false),
// damit Referenzen in bestehenden Angeboten (selected_product_ids) intakt bleiben.

// ─────────────────────────── Templates ───────────────────────────

/* GET /api/offer-catalog/templates?brand=talentone|nowag_wirth */
router.get('/templates', async (req, res) => {
  const { brand } = req.query || {};
  let q = supabase.from('talentone_offer_templates').select('*');
  if (brand) {
    if (!BRANDS.has(brand)) return res.status(400).json({ error: 'Ungültige brand.' });
    q = q.eq('brand', brand);
  }
  q = q.order('brand').order('key');
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ templates: data || [] });
});

/* PATCH /api/offer-catalog/templates/:id  body: { text } */
router.patch('/templates/:id', requireAdmin, async (req, res) => {
  const { text } = req.body || {};
  if (typeof text !== 'string') return res.status(400).json({ error: 'text ist Pflicht.' });
  const { data, error } = await supabase
    .from('talentone_offer_templates')
    .update({ text })
    .eq('id', req.params.id)
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Textbaustein nicht gefunden.' });
  res.json({ template: data });
});

/* POST /api/offer-catalog/templates  body: { brand, key, text } — für neue Bausteine */
router.post('/templates', requireAdmin, async (req, res) => {
  const b = req.body || {};
  if (!BRANDS.has(b.brand)) return res.status(400).json({ error: 'brand ungültig.' });
  if (!b.key || typeof b.key !== 'string') return res.status(400).json({ error: 'key ist Pflicht.' });
  if (typeof b.text !== 'string') return res.status(400).json({ error: 'text ist Pflicht.' });
  const { data, error } = await supabase
    .from('talentone_offer_templates')
    .insert({ brand: b.brand, key: b.key.trim(), text: b.text })
    .select().single();
  if (error) {
    if (String(error.message).includes('duplicate key')) {
      return res.status(409).json({ error: 'Textbaustein mit diesem (brand, key) existiert bereits.' });
    }
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json({ template: data });
});

export default router;
