// Admin: Verwaltung der Meta-Pixel (talentone_pixel) + Vorschlags-Bericht.
// Nur intern/Admin (Mount in server.js mit requireAuth + requireAdmin).
// Der CAPI-Token ist ein Secret und lebt ausschließlich in der Env
// (META_CAPI_TOKEN) — er wird hier NICHT ausgeliefert. Für die internen
// Pixel-Kacheln (Stelle/Funnel/Meta) liefert jobs.js /:id/pixel-context.
import { Router } from 'express';
import { supabase } from '../supabase.js';
import { suggestPixel } from '../pixel-mapping.js';
import { trackingReport } from '../meta-tracking.js';
import { syncMetaKampagnen } from '../meta-sync.js';

const router = Router();

const ALLOWED = ['name', 'gewerk', 'meta_pixel_id', 'aktiv', 'fallback', 'notiz'];

function clean(body) {
  return Object.fromEntries(Object.entries(body || {}).filter(([k]) => ALLOWED.includes(k)));
}

// Genau EIN Pixel darf fallback=true sein: setzt fallback bei allen anderen auf false.
async function setzeAlleinigenFallback(exceptId) {
  let q = supabase.from('talentone_pixel').update({ fallback: false }).eq('fallback', true);
  if (exceptId) q = q.neq('id', exceptId);
  const { error } = await q;
  if (error) throw new Error(error.message);
}

// GET /api/pixel — alle Pixel + Anzahl zugeordneter Stellen.
router.get('/', async (req, res) => {
  const { data: pixel, error } = await supabase
    .from('talentone_pixel').select('*').order('fallback', { ascending: false }).order('name');
  if (error) return res.status(500).json({ error: error.message });

  const { data: jobs = [] } = await supabase
    .from('talentone_jobs').select('pixel_id').not('pixel_id', 'is', null);
  const anzahl = {};
  for (const j of jobs) anzahl[j.pixel_id] = (anzahl[j.pixel_id] || 0) + 1;

  res.json({ pixel: (pixel || []).map(p => ({ ...p, anzahl_stellen: anzahl[p.id] || 0 })) });
});

// POST /api/pixel — anlegen.
router.post('/', async (req, res) => {
  const patch = clean(req.body);
  if (!patch.name?.trim() || !patch.gewerk?.trim() || !patch.meta_pixel_id?.trim()) {
    return res.status(400).json({ error: 'name, gewerk und meta_pixel_id sind Pflicht.' });
  }
  try {
    if (patch.fallback === true) await setzeAlleinigenFallback(null);
    const { data, error } = await supabase.from('talentone_pixel').insert(patch).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ pixel: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/pixel/:id — bearbeiten / deaktivieren / Fallback umsetzen.
router.patch('/:id', async (req, res) => {
  const patch = clean(req.body);
  try {
    const { data: aktuell } = await supabase
      .from('talentone_pixel').select('id, fallback, aktiv').eq('id', req.params.id).maybeSingle();
    if (!aktuell) return res.status(404).json({ error: 'Pixel nicht gefunden.' });

    // Fallback darf nicht direkt entzogen werden — stattdessen einen anderen Pixel
    // zum Fallback machen (das verschiebt ihn automatisch).
    if (patch.fallback === false && aktuell.fallback) {
      return res.status(400).json({ error: 'Setze zuerst einen anderen Pixel als Fallback — es muss genau einer sein.' });
    }
    // Der Fallback-Pixel darf nicht deaktiviert werden (sonst kein Auffangnetz).
    if (patch.aktiv === false && aktuell.fallback) {
      return res.status(400).json({ error: 'Der Fallback-Pixel kann nicht deaktiviert werden. Erst einen anderen zum Fallback machen.' });
    }
    if (patch.fallback === true) await setzeAlleinigenFallback(req.params.id);

    const { data, error } = await supabase
      .from('talentone_pixel').update(patch).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ pixel: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/pixel/bericht — je Stelle vorgeschlagener Pixel + Freitext aus
// projekte.pixel. NUR Anzeige — es wird nichts umgehängt (laufende Kampagnen
// bleiben beim bisherigen Pixel bis zum nächsten Kampagnenstart).
router.get('/bericht', async (req, res) => {
  try {
    const { data: pixel = [] } = await supabase.from('talentone_pixel').select('*');
    const byId = Object.fromEntries(pixel.map(p => [p.id, p]));

    const { data: jobs = [] } = await supabase
      .from('talentone_jobs')
      .select('id, stelle, kunde_id, projekt_id, pixel_id, projekttyp')
      .neq('projekttyp', 'sonstiges')
      .order('created_at', { ascending: false });

    // Platzhalter-Stellen ("[Briefing ausstehend]" o.ä.) ausblenden.
    const echte = jobs.filter(j => j.stelle && !j.stelle.trim().startsWith('['));

    const kundeIds = [...new Set(echte.map(j => j.kunde_id).filter(Boolean))];
    const projektIds = [...new Set(echte.map(j => j.projekt_id).filter(Boolean))];
    const [{ data: kunden = [] }, { data: projekte = [] }] = await Promise.all([
      kundeIds.length ? supabase.from('talentone_kunden').select('id, firmenname, branche').in('id', kundeIds) : Promise.resolve({ data: [] }),
      projektIds.length ? supabase.from('talentone_projekte').select('id, pixel, status').in('id', projektIds) : Promise.resolve({ data: [] }),
    ]);
    const kById = Object.fromEntries(kunden.map(k => [k.id, k]));
    const pById = Object.fromEntries(projekte.map(p => [p.id, p]));

    const zeilen = echte.map(j => {
      const kunde = kById[j.kunde_id] || null;
      const projekt = j.projekt_id ? pById[j.projekt_id] : null;
      const { vorschlag, gewerk, viaFallback } = suggestPixel({ stelle: j.stelle, branche: kunde?.branche }, pixel);
      const aktuell = j.pixel_id ? byId[j.pixel_id] : null;
      return {
        job_id: j.id,
        stelle: j.stelle,
        firmenname: kunde?.firmenname || '—',
        branche: kunde?.branche || null,
        projekt_status: projekt?.status || null,
        vorschlag: vorschlag ? { id: vorschlag.id, name: vorschlag.name, gewerk: vorschlag.gewerk, via_fallback: viaFallback } : null,
        vorschlag_gewerk: gewerk,
        aktueller_pixel: aktuell ? { id: aktuell.id, name: aktuell.name } : null,
        projekt_pixel_freitext: projekt?.pixel || null,
        abweichung: !!(aktuell && vorschlag && aktuell.id !== vorschlag.id),
      };
    });

    res.json({ zeilen });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/pixel/tracking?tage=14 — Abgleich Tool-Bewerbungen vs. Meta-Events
// je Stelle + Tracking-Quote + Liste „Pixel feuert nicht".
router.get('/tracking', async (req, res) => {
  try {
    const tage = Math.max(1, Math.min(90, Number(req.query.tage) || 14));
    res.json(await trackingReport(tage));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pixel/meta-backfill — Insights der letzten Tage neu ziehen
// (actions + leads/results nachtragen). backfill=true → 90 Tage.
router.post('/meta-backfill', async (req, res) => {
  try {
    const r = await syncMetaKampagnen({ backfill: true });
    res.json({ ok: true, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
