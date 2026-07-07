// Brand-Assets — Upload/Anzeige/Preview des Marken-Flyers (Phase 4b Nachtrag).
// Admin-only für Mutationen; Read auch für alle eingeloggten Teammitglieder
// (das SendOfferModal muss wissen, ob ein Flyer verfügbar ist).

import { Router } from 'express';
import { supabase } from '../supabase.js';
import { requireAdmin } from '../auth.js';
import { uploadBuffer, downloadFromBucket, deleteFromBucket } from '../storage.js';

const router = Router();
const BUCKET = 'brand-assets';
const BRANDS = new Set(['talentone', 'nowag_wirth']);
const MAX_BYTES = 8 * 1024 * 1024;

/* GET /api/offer-catalog/brand-assets?brand=…&asset_key=offer_flyer
   Meta-Daten des aktuellen Assets. */
router.get('/', async (req, res) => {
  const { brand, asset_key = 'offer_flyer' } = req.query || {};
  let q = supabase.from('talentone_brand_assets').select('*');
  if (brand) q = q.eq('brand', brand);
  q = q.eq('asset_key', asset_key);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ assets: data || [] });
});

/* GET /api/offer-catalog/brand-assets/:brand/preview
   Lädt das gespeicherte PDF und liefert es zurück (für Vorschau im Katalog). */
router.get('/:brand/preview', async (req, res) => {
  const brand = req.params.brand;
  if (!BRANDS.has(brand)) return res.status(400).json({ error: 'brand ungültig.' });
  try {
    const { data: asset } = await supabase.from('talentone_brand_assets')
      .select('*').eq('brand', brand).eq('asset_key', 'offer_flyer').maybeSingle();
    if (!asset) return res.status(404).json({ error: 'Kein Flyer hinterlegt.' });
    const buf = await downloadFromBucket({ bucket: BUCKET, path: asset.storage_path });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${asset.filename}"`);
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* POST /api/offer-catalog/brand-assets  body: { brand, filename, fileData (base64), size_bytes }
   Ersetzt den Flyer je Marke. Admin-only. */
router.post('/', requireAdmin, async (req, res) => {
  const { brand, filename, fileData, size_bytes } = req.body || {};
  if (!BRANDS.has(brand)) return res.status(400).json({ error: 'brand ungültig.' });
  if (!filename || !fileData) return res.status(400).json({ error: 'filename und fileData sind Pflicht.' });
  if (!/\.pdf$/i.test(filename)) return res.status(400).json({ error: 'Nur PDF-Dateien erlaubt.' });
  const size = Number(size_bytes) || 0;
  if (size > MAX_BYTES) return res.status(413).json({ error: `Datei > ${Math.round(MAX_BYTES/1024/1024)} MB.` });

  const path = `flyer/${brand}.pdf`;
  try {
    const buffer = Buffer.from(fileData.replace(/^data:.*?;base64,/, ''), 'base64');
    await uploadBuffer({ bucket: BUCKET, path, buffer, contentType: 'application/pdf', upsert: true });
    // Upsert Meta-Row
    const { data, error } = await supabase.from('talentone_brand_assets').upsert({
      brand, asset_key: 'offer_flyer',
      filename, size_bytes: buffer.length,
      storage_path: path, uploaded_by: req.user?.email || null,
      uploaded_at: new Date().toISOString(),
    }, { onConflict: 'brand,asset_key' }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ asset: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* DELETE /api/offer-catalog/brand-assets/:id */
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const { data: asset } = await supabase.from('talentone_brand_assets')
      .select('*').eq('id', req.params.id).maybeSingle();
    if (!asset) return res.status(404).json({ error: 'Asset nicht gefunden.' });
    await deleteFromBucket(BUCKET, asset.storage_path).catch(() => {});
    const { error } = await supabase.from('talentone_brand_assets').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
