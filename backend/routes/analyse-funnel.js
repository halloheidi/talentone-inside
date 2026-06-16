// Funnel-Report für den Recruiting-Check (analyse.talent-one.de).
// Liest aus talentone_analyse_sessions + talentone_analyse_events (Supabase).

import { Router } from 'express';
import { supabase } from '../supabase.js';

const router = Router();

function rangeBounds(range, from, to) {
  const now = new Date();
  let start, end = new Date(now);
  if (range === 'heute' || range === 'today') {
    start = new Date(now); start.setHours(0, 0, 0, 0);
  } else if (range === '7d') {
    start = new Date(now); start.setDate(start.getDate() - 7);
  } else if (range === '30d') {
    start = new Date(now); start.setDate(start.getDate() - 30);
  } else if (range === 'custom' && from) {
    start = new Date(from);
    if (to) end = new Date(to);
  } else {
    start = new Date(now); start.setDate(start.getDate() - 7);
  }
  return { start: start.toISOString(), end: end.toISOString() };
}

/* GET /api/analyse-funnel/stats?range=heute|7d|30d|custom&from=&to= */
router.get('/stats', async (req, res) => {
  const { range = '7d', from, to } = req.query;
  const { start, end } = rangeBounds(range, from, to);

  try {
    // Alle Events im Zeitfenster (paginiert via .range())
    const events = [];
    let page = 0;
    const PAGE = 1000;
    while (true) {
      const { data, error } = await supabase
        .from('talentone_analyse_events')
        .select('session_id,event_typ')
        .gte('created_at', start)
        .lte('created_at', end)
        .range(page * PAGE, (page + 1) * PAGE - 1);
      if (error) throw error;
      events.push(...(data || []));
      if (!data || data.length < PAGE) break;
      page++;
      if (page > 50) break; // Sicherheits-Cap (~50k Events)
    }

    // Sessions im Zeitfenster (für hat_email/hat_telefon-Zählung)
    const { data: sessions = [], error: sErr } = await supabase
      .from('talentone_analyse_sessions')
      .select('hat_email,hat_telefon,session_id')
      .gte('created_at', start)
      .lte('created_at', end);
    if (sErr) throw sErr;

    // Distinct session counts pro Event-Typ
    const setOf = (typ) => {
      const s = new Set();
      for (const e of events) if (e.event_typ === typ) s.add(e.session_id);
      return s.size;
    };
    const lead = sessions.filter(s => s.hat_email).length;
    const leadTel = sessions.filter(s => s.hat_telefon).length;

    res.json({
      range: { start, end, type: range },
      stages: {
        besucher: setOf('seite_besucht'),
        formular_gestartet: setOf('formular_gestartet'),
        formular_abgeschickt: setOf('formular_abgeschickt'),
        score_gesehen: setOf('score_gesehen'),
        teaser_gesehen: setOf('teaser_gesehen'),
        email_lead: lead,
        lead_mit_telefon: leadTel,
        volle_vorschau: setOf('volle_vorschau_gesehen'),
        blur_geklickt: setOf('blur_geklickt'),
        termin_cta: setOf('termin_cta_geklickt'),
        termin_gebucht: setOf('termin_gebucht'),
      },
      sessions_total: sessions.length,
      events_total: events.length,
    });
  } catch (err) {
    console.error('[analyse-funnel/stats]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* GET /api/analyse-funnel/sessions?range=…&limit=100 */
router.get('/sessions', async (req, res) => {
  const { range = '7d', from, to, limit = 100 } = req.query;
  const { start, end } = rangeBounds(range, from, to);
  const lim = Math.min(Math.max(Number(limit) || 100, 10), 500);

  try {
    const { data, error } = await supabase
      .from('talentone_analyse_sessions')
      .select('session_id,created_at,updated_at,stelle,region,creative_url,score,hat_email,hat_telefon,analyse_id,quelle')
      .gte('created_at', start)
      .lte('created_at', end)
      .order('created_at', { ascending: false })
      .limit(lim);
    if (error) throw error;

    // Für Lead-Sessions: zugehörige Analyse-Row lesen (E-Mail + Firma)
    const analyseIds = (data || []).map(s => s.analyse_id).filter(Boolean);
    let analysenMap = {};
    if (analyseIds.length) {
      const { data: analysen = [] } = await supabase
        .from('talentone_analysen')
        .select('id,firmenname,email,telefon,close_lead_id')
        .in('id', analyseIds);
      for (const a of analysen) analysenMap[a.id] = a;
    }

    const enriched = (data || []).map(s => ({
      ...s,
      analyse: s.analyse_id ? (analysenMap[s.analyse_id] || null) : null,
    }));

    res.json({ sessions: enriched, range: { start, end, type: range } });
  } catch (err) {
    console.error('[analyse-funnel/sessions]', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
