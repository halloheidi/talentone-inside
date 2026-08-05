// Globale Suche (Cmd+K): Kunden, Projekte, Jobs per ILIKE, je max. 5 Treffer.
// Archivierte Kunden ausgeblendet, außer die Suche beginnt mit "archiv:".
import { Router } from 'express';
import { supabase } from '../supabase.js';

const router = Router();
const LIMIT = 5;

router.get('/', async (req, res) => {
  let q = String(req.query.q || '').trim();
  let inklArchiv = false;
  if (/^archiv:/i.test(q)) { inklArchiv = true; q = q.replace(/^archiv:/i, '').trim(); }
  if (q.length < 2) return res.json({ kunden: [], projekte: [], jobs: [] });

  const pat = `%${q.replace(/[%_\\]/g, m => '\\' + m)}%`;

  let kQ = supabase.from('talentone_kunden')
    .select('id, firmenname, ansprechpartner, email, agentur, logo_url, archiviert')
    .or(`firmenname.ilike.${pat},ansprechpartner.ilike.${pat},email.ilike.${pat}`)
    .order('firmenname', { ascending: true }).limit(LIMIT);
  if (!inklArchiv) kQ = kQ.eq('archiviert', false);

  const pQ = supabase.from('talentone_projekte')
    .select('id, projekt, kunde, kunde_id, status')
    .or(`projekt.ilike.${pat},kunde.ilike.${pat}`)
    .order('created_at', { ascending: false }).limit(LIMIT);

  const jQ = supabase.from('talentone_jobs')
    .select('id, stelle, region, kunde_id')
    .or(`stelle.ilike.${pat},region.ilike.${pat}`)
    .order('created_at', { ascending: false }).limit(LIMIT);

  const [k, p, j] = await Promise.all([kQ, pQ, jQ]);
  if (k.error || p.error || j.error) {
    return res.status(500).json({ error: (k.error || p.error || j.error).message });
  }
  res.json({
    kunden: k.data || [],
    projekte: p.data || [],
    jobs: j.data || [],
  });
});

export default router;
