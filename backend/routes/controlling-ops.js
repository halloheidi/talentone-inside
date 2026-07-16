// Operatives Controlling-Dashboard ("Wo brennt es?") — für ALLE Mitarbeiter.
// Getrennt vom Finanz-Controlling (routes/controlling.js, admin-only).
//
//   GET /api/controlling-ops/overview?days=14|from&to&status=live|aktiv|alle&agentur=alle|talentone|nowagwirth
//   GET /api/controlling-ops/kunde/:kundeId?days=…&from&to
//
// Klickdaten (Funnel-Aufrufe) werden serverseitig NICHT getrackt (nur Meta-Pixel),
// daher zeigt die Conversion-Kette Bewerbungen → qualifiziert, kein "Besucher".

import { Router } from 'express';
import { supabase } from '../supabase.js';
import {
  AMPEL_CONFIG, AMPEL_RANG, STATUS_GRUPPEN, WOCHENTAGE,
  berlinParts, parseSollTage, tageSeit, computeAmpel,
} from '../controlling-ops-service.js';

const router = Router();
const DAY = 86400000;

function parseRange(q) {
  const now = new Date();
  if (q.from) {
    const start = new Date(q.from + 'T00:00:00Z');
    const end = q.to ? new Date(q.to + 'T23:59:59.999Z') : now;
    return { start, end, tage: Math.max(1, Math.round((end - start) / DAY)) };
  }
  const tage = [7, 14, 30].includes(Number(q.days)) ? Number(q.days) : 14;
  return { start: new Date(now.getTime() - tage * DAY), end: now, tage };
}

// Berlin-Tagesachse (Liste von YYYY-MM-DD) zwischen zwei Zeitpunkten.
function dateAxis(start, end) {
  const days = [], seen = new Set();
  for (let t = start.getTime(); t <= end.getTime(); t += DAY / 2) {
    const key = berlinParts(new Date(t)).dateKey;
    if (!seen.has(key)) { seen.add(key); days.push(key); }
  }
  return days;
}

// Bewerbungen für viele job_ids laden (chunked .in), zeitlich optional begrenzt.
async function loadBewerbungen(jobIds, sinceIso = null) {
  if (!jobIds.length) return [];
  const out = [];
  for (let i = 0; i < jobIds.length; i += 150) {
    const chunk = jobIds.slice(i, i + 150);
    let q = supabase.from('talentone_bewerbungen')
      .select('id, created_at, job_id, ko_kriterium, quelle')
      .in('job_id', chunk);
    if (sinceIso) q = q.gte('created_at', sinceIso);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...(data || []));
  }
  return out;
}

function within(iso, start, end) {
  const t = new Date(iso).getTime();
  return t >= start.getTime() && t <= end.getTime();
}

// Wochentags- + Uhrzeit-Verteilung + Tagesreihe aus Bewerbungen (Berlin-Zeit).
function verteilungen(bews, axis) {
  const perTagMap = Object.fromEntries(axis.map(d => [d, 0]));
  const wochentag = Array(7).fill(0);
  const stunde = Array(24).fill(0);
  for (const b of bews) {
    const p = berlinParts(b.created_at);
    if (p.dateKey in perTagMap) perTagMap[p.dateKey] += 1;
    wochentag[p.weekday] += 1;
    stunde[p.hour] += 1;
  }
  return {
    per_tag: axis.map(d => ({
      date: d,
      label: d.slice(8) + '.' + d.slice(5, 7), // TT.MM
      count: perTagMap[d],
    })),
    wochentag: WOCHENTAGE.map((t, i) => ({ tag: t, count: wochentag[i] })),
    stunde: stunde.map((count, h) => ({ stunde: `${String(h).padStart(2, '0')}`, count })),
  };
}

function funnelTyp(funnels) {
  if (!funnels.length) return null;
  const extern = funnels.some(f => f.extern);
  const intern = funnels.some(f => !f.extern);
  if (extern && intern) return 'gemischt';
  return extern ? 'extern' : 'intern';
}

/* ═══════════════════ /overview ═══════════════════ */
router.get('/overview', async (req, res) => {
  try {
    const { start, end, tage } = parseRange(req.query);
    const statusKey = ['live', 'aktiv', 'alle'].includes(req.query.status) ? req.query.status : 'live';
    const agenturFilter = ['talentone', 'nowagwirth'].includes(req.query.agentur) ? req.query.agentur : null;
    const now = new Date();

    // 1) Projekte nach Status
    let pq = supabase.from('talentone_projekte')
      .select('id, kunde_id, kunde, status, projektdauer, start_phase1, ende_phase1, live_termin, agentur, verantwortlich, projekt, gesuchte_positionen, standorte');
    const statusListe = STATUS_GRUPPEN[statusKey];
    if (statusListe) pq = pq.in('status', statusListe);
    const { data: projekteRaw, error: pErr } = await pq;
    if (pErr) throw pErr;

    // 2) Kunden (Agentur autoritativ, archivierte raus)
    const kundeIds = [...new Set((projekteRaw || []).map(p => p.kunde_id).filter(Boolean))];
    const kundeMap = {};
    if (kundeIds.length) {
      const { data: kunden, error: kErr } = await supabase.from('talentone_kunden')
        .select('id, firmenname, agentur, archiviert').in('id', kundeIds);
      if (kErr) throw kErr;
      for (const k of kunden || []) kundeMap[k.id] = k;
    }

    // Projekte filtern: gültiger, nicht-archivierter Kunde + Agentur
    const projekte = (projekteRaw || []).filter(p => {
      const k = kundeMap[p.kunde_id];
      if (!k || k.archiviert) return false;
      if (agenturFilter && (k.agentur || p.agentur) !== agenturFilter) return false;
      return true;
    });

    // 3) Jobs der betroffenen Kunden
    const finalKundeIds = [...new Set(projekte.map(p => p.kunde_id))];
    const jobsByKunde = {}; const jobKunde = {}; const alleJobIds = [];
    if (finalKundeIds.length) {
      const { data: jobs, error: jErr } = await supabase.from('talentone_jobs')
        .select('id, kunde_id, stelle, bewerbungen_token, created_at')
        .in('kunde_id', finalKundeIds).order('created_at', { ascending: true });
      if (jErr) throw jErr;
      for (const j of jobs || []) {
        (jobsByKunde[j.kunde_id] ||= []).push(j);
        jobKunde[j.id] = j.kunde_id;
        alleJobIds.push(j.id);
      }
    }

    // 4) Funnels (intern/extern) je Job
    const funnelByJob = {};
    if (alleJobIds.length) {
      for (let i = 0; i < alleJobIds.length; i += 150) {
        const chunk = alleJobIds.slice(i, i + 150);
        const { data: funnels } = await supabase.from('talentone_funnels')
          .select('job_id, extern, veroeffentlicht').in('job_id', chunk);
        for (const f of funnels || []) (funnelByJob[f.job_id] ||= []).push(f);
      }
    }

    // 5) Bewerbungen (all-time für "letzte Bewerbung"; Volumen klein)
    const alleBews = await loadBewerbungen(alleJobIds);
    const bewsByKunde = {};
    for (const b of alleBews) {
      const kid = jobKunde[b.job_id];
      if (kid) (bewsByKunde[kid] ||= []).push(b);
    }

    const sparkAxis = dateAxis(new Date(now.getTime() - 13 * DAY), now); // letzte 14 Tage
    const rangeAxis = dateAxis(start, end);

    // 6) Zeilen bauen
    const rows = projekte.map(p => {
      const k = kundeMap[p.kunde_id];
      const jobs = jobsByKunde[p.kunde_id] || [];
      const bews = bewsByKunde[p.kunde_id] || [];
      const liveStart = p.start_phase1 || p.live_termin || null;
      const liveStartIso = liveStart ? new Date(liveStart + (String(liveStart).length <= 10 ? 'T00:00:00Z' : '')).toISOString() : null;
      const liveTag = tageSeit(liveStartIso, now);
      const sollTage = parseSollTage(p.projektdauer);

      const sorted = [...bews].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      const letzte = sorted[0]?.created_at || null;
      const letzteBewerbungTage = letzte ? tageSeit(letzte, now) : null;

      const bewerbungenRange = bews.filter(b => within(b.created_at, start, end)).length;
      const letzte7 = bews.filter(b => new Date(b.created_at) >= new Date(now - 7 * DAY)).length;
      const vorwoche = bews.filter(b => {
        const d = new Date(b.created_at);
        return d >= new Date(now - 14 * DAY) && d < new Date(now - 7 * DAY);
      }).length;
      const bewerbungenSeitLive = liveStartIso
        ? bews.filter(b => new Date(b.created_at) >= new Date(liveStartIso)).length
        : bews.length;

      const spark = Object.fromEntries(sparkAxis.map(d => [d, 0]));
      for (const b of bews) { const dk = berlinParts(b.created_at).dateKey; if (dk in spark) spark[dk] += 1; }

      const { ampel, grund } = computeAmpel({
        status: p.status, liveTag, sollTage, letzteBewerbungTage,
        bewerbungenSeitLive, letzte7, vorwoche,
      });

      const jobFunnels = jobs.flatMap(j => funnelByJob[j.id] || []);
      const primaryJob = jobs[0] || null;

      return {
        projekt_id: p.id,
        kunde_id: p.kunde_id,
        kunde: k?.firmenname || p.kunde || 'Unbekannt',
        agentur: k?.agentur || p.agentur || null,
        status: p.status,
        verantwortlich: p.verantwortlich || null,
        stelle: primaryJob?.stelle || p.gesuchte_positionen || p.projekt || '—',
        anzahl_stellen: jobs.length,
        primary_job_id: primaryJob?.id || null,
        bewerbungen_token: primaryJob?.bewerbungen_token || null,
        live_tag: liveTag,
        soll_tage: sollTage,
        live_start: liveStartIso,
        bewerbungen_range: bewerbungenRange,
        bewerbungen_gesamt: bews.length,
        letzte_bewerbung_tage: letzteBewerbungTage,
        sparkline: sparkAxis.map(d => ({ date: d, count: spark[d] })),
        ampel, ampel_grund: grund,
        funnel_extern: funnelTyp(jobFunnels) === 'extern' ? true
          : funnelTyp(jobFunnels) === 'intern' ? false : null,
      };
    }).sort((a, b) => {
      if (AMPEL_RANG[a.ampel] !== AMPEL_RANG[b.ampel]) return AMPEL_RANG[a.ampel] - AMPEL_RANG[b.ampel];
      const at = a.letzte_bewerbung_tage ?? 9999, bt = b.letzte_bewerbung_tage ?? 9999;
      if (at !== bt) return bt - at; // länger ohne Bewerbung zuerst
      return a.bewerbungen_range - b.bewerbungen_range;
    });

    // 7) Aggregierte Charts über alle gefilterten Jobs im Zeitraum
    const rangeBews = alleBews.filter(b => jobKunde[b.job_id] && finalKundeIds.includes(jobKunde[b.job_id]) && within(b.created_at, start, end));
    const charts = verteilungen(rangeBews, rangeAxis);

    const totals = {
      projekte: rows.length,
      rot: rows.filter(r => r.ampel === 'rot').length,
      gelb: rows.filter(r => r.ampel === 'gelb').length,
      gruen: rows.filter(r => r.ampel === 'gruen').length,
      grau: rows.filter(r => r.ampel === 'grau').length,
      bewerbungen: rangeBews.length,
    };

    const kundenListe = finalKundeIds
      .map(id => ({ id, firmenname: kundeMap[id]?.firmenname || 'Unbekannt' }))
      .filter(k => (jobsByKunde[k.id] || []).length)
      .sort((a, b) => a.firmenname.localeCompare(b.firmenname, 'de'));

    res.json({
      range: { from: start.toISOString(), to: end.toISOString(), tage },
      filter: { status: statusKey, agentur: agenturFilter || 'alle' },
      totals, rows, charts, kunden: kundenListe,
      thresholds: AMPEL_CONFIG,
    });
  } catch (err) {
    console.error('[controlling-ops/overview]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════ /kunde/:kundeId (Drilldown) ═══════════════════ */
router.get('/kunde/:kundeId', async (req, res) => {
  try {
    const { start, end } = parseRange(req.query);
    const { data: kunde } = await supabase.from('talentone_kunden')
      .select('id, firmenname, agentur').eq('id', req.params.kundeId).maybeSingle();
    if (!kunde) return res.status(404).json({ error: 'Kunde nicht gefunden.' });

    const { data: jobs } = await supabase.from('talentone_jobs')
      .select('id, stelle, bewerbungen_token').eq('kunde_id', kunde.id).order('created_at', { ascending: true });
    const jobIds = (jobs || []).map(j => j.id);

    const funnelByJob = {};
    if (jobIds.length) {
      for (let i = 0; i < jobIds.length; i += 150) {
        const { data: funnels } = await supabase.from('talentone_funnels')
          .select('job_id, extern').in('job_id', jobIds.slice(i, i + 150));
        for (const f of funnels || []) (funnelByJob[f.job_id] ||= []).push(f);
      }
    }

    const alleBews = await loadBewerbungen(jobIds);
    const rangeBews = alleBews.filter(b => within(b.created_at, start, end));
    const charts = verteilungen(rangeBews, dateAxis(start, end));

    const qualifiziert = rangeBews.filter(b => !b.ko_kriterium).length;
    const quellen = {
      funnel: rangeBews.filter(b => b.quelle === 'funnel').length,
      perspective: rangeBews.filter(b => b.quelle === 'perspective').length,
      andere: rangeBews.filter(b => !['funnel', 'perspective'].includes(b.quelle)).length,
    };
    const typ = funnelTyp((jobs || []).flatMap(j => funnelByJob[j.id] || []));
    const hinweis = typ === 'extern'
      ? 'Externer Funnel (Perspective/onepage) — Klick-/Besucherdaten liegen extern und sind hier nicht verfügbar.'
      : 'Funnel-Aufrufe werden serverseitig nicht getrackt (nur Meta-Pixel). Angezeigt ab Bewerbungseingang.';

    // Bewerbungen je Stelle
    const bewsProJob = {};
    for (const b of rangeBews) bewsProJob[b.job_id] = (bewsProJob[b.job_id] || 0) + 1;

    res.json({
      kunde: { id: kunde.id, firmenname: kunde.firmenname, agentur: kunde.agentur },
      range: { from: start.toISOString(), to: end.toISOString() },
      charts,
      conversion: {
        funnel_typ: typ,
        besucher: null,
        bewerbungen: rangeBews.length,
        qualifiziert,
        quote: rangeBews.length ? Math.round((qualifiziert / rangeBews.length) * 1000) / 10 : null,
        hinweis,
      },
      quellen,
      stellen: (jobs || []).map(j => ({
        job_id: j.id, stelle: j.stelle || '—',
        bewerbungen_token: j.bewerbungen_token || null,
        bewerbungen: bewsProJob[j.id] || 0,
      })),
    });
  } catch (err) {
    console.error('[controlling-ops/kunde]', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
