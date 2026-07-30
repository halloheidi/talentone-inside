import { Router } from 'express';
import { supabase } from '../supabase.js';
import { requireAdmin } from '../auth.js';
import { uploadBuffer, deleteFromBucket, safeFilenameStem, ensureBucket } from '../storage.js';
import { normalizeImageForStorage } from '../imageops.js';
import { callClaudeWithRetry, parseJsonContent } from '../claude.js';

const router = Router();
const BUCKET = 'talentone-creatives'; // öffentlicher Bucket, wird für Beispielbilder mitgenutzt
const CLAUDE_MODEL = 'claude-sonnet-4-6';

/* GET /api/stilvorlagen?include_inactive=1 */
router.get('/', async (req, res) => {
  const includeInactive = req.query.include_inactive === '1';
  let q = supabase.from('talentone_stilvorlagen').select('*')
    .order('reihenfolge', { ascending: true });
  if (!includeInactive) q = q.eq('aktiv', true);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ stilvorlagen: data || [] });
});

router.get('/:id', async (req, res) => {
  const { data, error } = await supabase.from('talentone_stilvorlagen')
    .select('*').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Stilvorlage nicht gefunden.' });
  res.json({ stilvorlage: data });
});

const ALLOWED = ['name', 'beschreibung', 'layout_prompt', 'vorschau_url',
                 'referenzbild_nutzen', 'aktiv', 'reihenfolge', 'beispielbild_urls'];

router.post('/', async (req, res) => {
  const patch = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => ALLOWED.includes(k)));
  if (!patch.name || !patch.layout_prompt) {
    return res.status(400).json({ error: 'name und layout_prompt sind Pflicht.' });
  }
  const { data, error } = await supabase.from('talentone_stilvorlagen')
    .insert(patch).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ stilvorlage: data });
});

router.patch('/:id', async (req, res) => {
  const patch = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => ALLOWED.includes(k)));
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('talentone_stilvorlagen')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ stilvorlage: data });
});

router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('talentone_stilvorlagen')
    .delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

/* POST /api/stilvorlagen/:id/beispielbild  body: { fileData(base64), fileName?, contentType? }
   Lädt ein Beispiel-Creative hoch, hängt es an beispielbild_urls an; das erste Bild
   wird automatisch vorschau_url + referenzbild_nutzen=true (Default AN bei Upload). */
router.post('/:id/beispielbild', requireAdmin, async (req, res) => {
  const { fileData, fileName, contentType } = req.body || {};
  if (!fileData) return res.status(400).json({ error: 'Kein Bild übergeben.' });
  const { data: vorlage } = await supabase.from('talentone_stilvorlagen')
    .select('*').eq('id', req.params.id).maybeSingle();
  if (!vorlage) return res.status(404).json({ error: 'Stilvorlage nicht gefunden.' });

  try {
    const raw = Buffer.from(String(fileData).replace(/^data:.*?;base64,/, ''), 'base64');
    const norm = await normalizeImageForStorage(raw, { kind: 'foto', label: fileName || 'Beispielbild' });
    await ensureBucket(BUCKET, { isPublic: true });
    const stem = safeFilenameStem(fileName || 'beispiel');
    const path = `stilvorlagen/${vorlage.id}/${Date.now()}-${stem}.${norm.ext}`;
    const url = await uploadBuffer({ bucket: BUCKET, path, buffer: norm.buffer, contentType: norm.contentType, upsert: true });

    const urls = [...(Array.isArray(vorlage.beispielbild_urls) ? vorlage.beispielbild_urls : []), url];
    const update = {
      beispielbild_urls: urls,
      vorschau_url: vorlage.vorschau_url || url,           // erstes Bild = Thumbnail
      referenzbild_nutzen: vorlage.beispielbild_urls?.length ? vorlage.referenzbild_nutzen : true, // Default AN beim ersten Upload
      updated_at: new Date().toISOString(),
    };
    const { data: saved, error } = await supabase.from('talentone_stilvorlagen')
      .update(update).eq('id', vorlage.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ stilvorlage: saved, url });
  } catch (err) {
    console.error('[stilvorlage-upload]', err.message);
    res.status(err.userMessage ? 400 : 500).json({ error: err.userMessage || err.message });
  }
});

/* DELETE /api/stilvorlagen/:id/beispielbild  body: { url } */
router.delete('/:id/beispielbild', requireAdmin, async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url fehlt.' });
  const { data: vorlage } = await supabase.from('talentone_stilvorlagen')
    .select('*').eq('id', req.params.id).maybeSingle();
  if (!vorlage) return res.status(404).json({ error: 'Stilvorlage nicht gefunden.' });

  const urls = (Array.isArray(vorlage.beispielbild_urls) ? vorlage.beispielbild_urls : []).filter(u => u !== url);
  const update = {
    beispielbild_urls: urls,
    vorschau_url: vorlage.vorschau_url === url ? (urls[0] || null) : vorlage.vorschau_url,
    updated_at: new Date().toISOString(),
  };
  const { data: saved, error } = await supabase.from('talentone_stilvorlagen')
    .update(update).eq('id', vorlage.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  deleteFromBucket(BUCKET, url).catch(() => {});
  res.json({ stilvorlage: saved });
});

/* POST /api/stilvorlagen/layout-vorschlag  body: { imageUrl }
   Claude-Vision analysiert das Beispielbild und schreibt einen layout_prompt-Text. */
router.post('/layout-vorschlag', requireAdmin, async (req, res) => {
  const { imageUrl } = req.body || {};
  if (!imageUrl) return res.status(400).json({ error: 'imageUrl fehlt.' });
  const anweisung = `Du bist Art-Director für Recruiting-Anzeigen. Analysiere das beigefügte Beispiel-Creative und beschreibe präzise dessen LAYOUT- und GESTALTUNGS-SYSTEM als wiederverwendbare Vorlage-Anweisung für eine KI-Bildgenerierung.

Beschreibe:
• Grundaufbau/Zonen (Aufteilung oben/Mitte/unten, was wo sitzt)
• Anordnung & Größen-Hierarchie der Elemente: Stellenbezeichnung, Hook/Spruch, Benefit-Badges, Firmenname/Logo, Meta-Leiste (Ort/Gehalt)
• Typografie-Stil (Schriftcharakter, Groß/Fett, Farbflächen oder Banner hinter Text, Pinselstriche)
• Gestaltungsprinzipien (Badges, Formen, Farbeinsatz, Platzierung von Person/Bildmotiv, Ebenen/Überlappungen)

Nutze wo sinnvoll diese Platzhalter (in geschweiften Klammern), damit die Vorlage kundenübergreifend funktioniert:
{stelle_gross}, {meta_leiste}, {benefits_liste}, {firmenname}, {hook_anweisung}, {logo_platzierung}, {farben_hinweis}

WICHTIG: Beschreibe NUR Aufbau/Stil. Übernimm KEINE konkreten Texte, Namen, Personen oder Logos aus dem Bild. Antworte NUR mit dem fertigen Layout-Text (kein Vorspann, keine Anführungszeichen, kein Markdown).`;

  try {
    const data = await callClaudeWithRetry({
      model: CLAUDE_MODEL,
      max_tokens: 1400,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: imageUrl } },
          { type: 'text', text: anweisung },
        ],
      }],
    });
    const text = (data?.content?.[0]?.text || '').trim();
    if (!text) return res.status(502).json({ error: 'Keine Layout-Beschreibung erhalten.' });
    res.json({ layout_prompt: text });
  } catch (err) {
    console.error('[layout-vorschlag]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* POST /api/stilvorlagen/aus-bild  body: { fileData(base64), fileName?, contentType? }
   Ein-Klick-Weg: legt aus EINEM Bild direkt eine fertige, aktive Vorlage an —
   Bild normalisieren+hochladen, per Claude-Vision Name + layout_prompt ableiten,
   referenzbild_nutzen=true. Kein Formular. */
const FALLBACK_LAYOUT = `Orientiere dich am beigefügten Stilbeispiel. Baue das Creative in klaren Zonen auf: {stelle_gross} prominent und formatfüllend, {hook_anweisung}, {benefits_liste} als kompakte runde Badges, {logo_platzierung}, {meta_leiste} dezent. {farben_hinweis} Moderne, gut lesbare Typografie; Person/Bildmotiv im Vordergrund.`;

router.post('/aus-bild', requireAdmin, async (req, res) => {
  const { fileData, fileName, contentType } = req.body || {};
  if (!fileData) return res.status(400).json({ error: 'Kein Bild übergeben.' });
  try {
    const raw = Buffer.from(String(fileData).replace(/^data:.*?;base64,/, ''), 'base64');
    const norm = await normalizeImageForStorage(raw, { kind: 'foto', label: fileName || 'Stilvorlage' });
    await ensureBucket(BUCKET, { isPublic: true });
    const stem = safeFilenameStem(fileName || 'stilvorlage');
    const path = `stilvorlagen/neu/${Date.now()}-${stem}.${norm.ext}`;
    const url = await uploadBuffer({ bucket: BUCKET, path, buffer: norm.buffer, contentType: norm.contentType, upsert: true });

    // Vision: Name + Layout-Beschreibung ableiten (best-effort, mit Fallback).
    let name = null;
    let layout_prompt = null;
    try {
      const anweisung = `Analysiere das beigefügte Beispiel-Creative (Recruiting-Anzeige) und liefere ZWEI Dinge:
1) "name": ein kurzer, prägnanter Stil-Name (2–4 Wörter, beschreibt den Look, z. B. "Bold Typo dunkel", "Foto-Fokus hell", "Pinselstrich orange").
2) "layout_prompt": eine wiederverwendbare Layout-/Gestaltungs-Anweisung für eine KI-Bildgenerierung — Grundaufbau/Zonen, Größen-Hierarchie (Stellenbezeichnung, Hook, Benefit-Badges, Firmenname/Logo, Meta-Leiste), Typografie-Stil, Gestaltungsprinzipien (Formen, Farbeinsatz, Person-Platzierung, Ebenen). Nutze wo sinnvoll Platzhalter: {stelle_gross}, {meta_leiste}, {benefits_liste}, {firmenname}, {hook_anweisung}, {logo_platzierung}, {farben_hinweis}. Beschreibe NUR Aufbau/Stil — übernimm KEINE konkreten Texte, Namen, Personen oder Logos aus dem Bild.

Antworte AUSSCHLIESSLICH als JSON: {"name": "...", "layout_prompt": "..."}`;
      const data = await callClaudeWithRetry({
        model: CLAUDE_MODEL,
        max_tokens: 1500,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'url', url } },
          { type: 'text', text: anweisung },
        ] }],
      });
      const parsed = parseJsonContent(data);
      if (parsed?.name) name = String(parsed.name).trim().slice(0, 80);
      if (parsed?.layout_prompt) layout_prompt = String(parsed.layout_prompt).trim();
    } catch (e) { console.warn('[stilvorlage-aus-bild vision]', e.message); }

    if (!name) name = `Vorlage ${new Date().toLocaleDateString('de-DE')}`;
    if (!layout_prompt) layout_prompt = FALLBACK_LAYOUT;

    const { data: saved, error } = await supabase.from('talentone_stilvorlagen').insert({
      name, layout_prompt,
      vorschau_url: url,
      beispielbild_urls: [url],
      referenzbild_nutzen: true,
      aktiv: true,
      reihenfolge: 100,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ stilvorlage: saved });
  } catch (err) {
    console.error('[stilvorlage-aus-bild]', err.message);
    res.status(err.userMessage ? 400 : 500).json({ error: err.userMessage || err.message });
  }
});

export default router;
