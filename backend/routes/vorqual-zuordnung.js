import { Router } from 'express';
import { supabase } from '../supabase.js';
import { requireAdmin } from '../auth.js';
import { ladeStandardfelder } from '../vorqual-standardfelder.js';

// Zuordnung je Stelle: stellenspezifische Vorqual-Felder (talentone_jobs.
// vorqualifizierung_felder) auf globale Standardfelder abbilden. Werte liegen
// intern in talentone_bewerber_notizen.vorqualifizierung_werte[<feldname>].
// Beim Übernehmen wird der Wert ins Zielfeld kopiert (notiz_feld-Spalte oder
// vorqualifizierung_werte[std_key]), der stellenspezifische Schlüssel entfernt
// und die Felddefinition aus allen betroffenen Jobs gelöscht. Der Kunden-
// Override vorqual_werte_kunde bleibt UNANGETASTET.

const router = Router();

const istGefuellt = (v) => String(v ?? '').trim() !== '';
const norm = (s) => String(s ?? '').trim().toLowerCase();

/* ──────────────────── Vorschlag (Feldname → Standardfeld) ──────────────────── */

// Hartkodierte Hinweise: Feldname enthält eines von `wenn` → bevorzuge das
// aktive Standardfeld, dessen Name eines von `bevorzuge` enthält (Priorität).
const HINTS = [
  { wenn: ['wechselmotivation', 'wechselgrund', 'motivation', 'wechsel'], bevorzuge: ['wechselmotivation', 'motivation'] },
  { wenn: ['gehaltsvorstellung', 'gehaltswunsch', 'gehalt'], bevorzuge: ['gehaltswunsch', 'gehalt'] },
  { wenn: ['plz', 'wohnort'], bevorzuge: ['aktuelle plz', 'plz', 'wohnort'] },
  { wenn: ['aktuelle situation', 'aktuelle tätigkeit', 'aktuelle taetigkeit', 'tätigkeit', 'taetigkeit'], bevorzuge: ['aktuelle tätigkeit', 'aktuelle taetigkeit', 'tätigkeit', 'taetigkeit'] },
  { wenn: ['ausbildung'], bevorzuge: ['ausbildung abgeschlossen', 'ausbildung'] },
];

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let cur = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

function aehnlichkeit(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const lev = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  const ta = new Set(a.split(/[^a-zäöüß0-9]+/).filter(Boolean));
  const tb = new Set(b.split(/[^a-zäöüß0-9]+/).filter(Boolean));
  let gemeinsam = 0;
  for (const t of ta) if (tb.has(t)) gemeinsam++;
  const token = (ta.size && tb.size) ? gemeinsam / Math.max(ta.size, tb.size) : 0;
  return Math.max(lev, token);
}

// Liefert die vorgeschlagene Standardfeld-id (oder null = nicht zuordnen).
function vorschlagFuer(feldName, standardfelder) {
  const n = norm(feldName);
  // 1) Hartkodierte Hinweise
  for (const hint of HINTS) {
    if (!hint.wenn.some(w => n.includes(w))) continue;
    for (const pref of hint.bevorzuge) {
      const treffer = standardfelder.find(sf => norm(sf.name).includes(pref));
      if (treffer) return treffer.id;
    }
  }
  // 2) Allgemeine Ähnlichkeit
  let best = null, bestScore = 0;
  for (const sf of standardfelder) {
    const s = aehnlichkeit(feldName, sf.name);
    if (s > bestScore) { bestScore = s; best = sf; }
  }
  return bestScore >= 0.5 && best ? best.id : null;
}

/* ──────────────────── Daten-Sammlung ──────────────────── */

// Alle Jobs mit ihren stellenspezifischen Feldern. Gruppiert distinkte
// Feldnamen (die NICHT exakt einem aktiven Standardfeld entsprechen) und merkt
// sich je Gruppe die betroffenen Jobs inkl. der exakten Feldnamen pro Job
// (Casing/Whitespace können je Stelle abweichen; der werte-Schlüssel ist der
// exakte Name).
async function sammleGruppen(standardfelder) {
  const stdNamen = new Set(standardfelder.map(sf => norm(sf.name)));
  const { data: jobs = [], error } = await supabase
    .from('talentone_jobs').select('id, vorqualifizierung_felder');
  if (error) throw new Error(error.message);

  const gruppen = new Map(); // normName → { name, exakteNamen:Set, jobIds:Set }
  for (const job of jobs || []) {
    const felder = Array.isArray(job?.vorqualifizierung_felder) ? job.vorqualifizierung_felder : [];
    for (const f of felder) {
      const name = f && typeof f === 'object' ? String(f.name ?? '').trim() : '';
      if (!name) continue;
      const nn = norm(name);
      if (stdNamen.has(nn)) continue; // schon Standard → überspringen
      let g = gruppen.get(nn);
      if (!g) { g = { name, exakteNamen: new Set(), jobIds: new Set() }; gruppen.set(nn, g); }
      g.exakteNamen.add(name);
      g.jobIds.add(job.id);
    }
  }
  return gruppen;
}

// Zielfeld ist leer? notiz_feld-Spalte ODER vorqualifizierung_werte[std_key].
function zielLeer(notiz, ziel) {
  if (ziel.notiz_feld) return !istGefuellt(notiz?.[ziel.notiz_feld]);
  const werte = (notiz?.vorqualifizierung_werte && typeof notiz.vorqualifizierung_werte === 'object') ? notiz.vorqualifizierung_werte : {};
  return !istGefuellt(werte[ziel.std_key]);
}

// Holt alle Notizen zu den bewerbungen einer Job-Menge. Liefert zudem je Notiz
// den (ersten gefüllten) Quell-Wert anhand der exakten Feldnamen der Gruppe.
async function ladeNotizenFuer(jobIds, exakteNamen) {
  const { data: bews = [] } = await supabase
    .from('talentone_bewerbungen').select('id').in('job_id', jobIds);
  const bewIds = (bews || []).map(b => b.id);
  if (!bewIds.length) return [];
  const notizen = [];
  // In Blöcken holen (gegen zu lange IN-Listen).
  for (let i = 0; i < bewIds.length; i += 500) {
    const teil = bewIds.slice(i, i + 500);
    const { data = [] } = await supabase
      .from('talentone_bewerber_notizen')
      .select('bewerbung_id, vorqualifizierung_werte, gehaltswunsch, verfuegbarkeit')
      .in('bewerbung_id', teil);
    for (const n of data || []) notizen.push(n);
  }
  return notizen.map(n => {
    const werte = (n.vorqualifizierung_werte && typeof n.vorqualifizierung_werte === 'object') ? n.vorqualifizierung_werte : {};
    let quellWert = '';
    for (const name of exakteNamen) {
      if (istGefuellt(werte[name])) { quellWert = werte[name]; break; }
    }
    return { ...n, _quellWert: quellWert };
  });
}

/* ──────────────────── Routen ──────────────────── */

// GET /api/vorqual-zuordnung — Zeilen + Standardfeld-Liste (ohne Dry-Run-Counts;
// die holt das Frontend per /dry-run je ausgewähltem Ziel).
router.get('/', requireAdmin, async (req, res) => {
  try {
    const standardfelder = await ladeStandardfelder();
    const gruppen = await sammleGruppen(standardfelder);
    const rows = [...gruppen.values()]
      .map(g => ({
        name: g.name,
        stellen_count: g.jobIds.size,
        vorschlag_id: vorschlagFuer(g.name, standardfelder),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));
    res.json({
      rows,
      standardfelder: standardfelder.map(sf => ({
        id: sf.id, name: sf.name, typ: sf.typ, notiz_feld: sf.notiz_feld, std_key: sf.std_key,
      })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/vorqual-zuordnung/dry-run?name=..&ziel_feld_id=..
// Wie viele Bewerber (über alle betroffenen Stellen) haben das Quellfeld gefüllt
// UND das Zielfeld aktuell leer.
router.get('/dry-run', requireAdmin, async (req, res) => {
  try {
    const name = String(req.query.name ?? '').trim();
    const zielId = req.query.ziel_feld_id;
    if (!name || !zielId) return res.json({ count: 0 });
    const standardfelder = await ladeStandardfelder();
    const ziel = standardfelder.find(sf => String(sf.id) === String(zielId));
    if (!ziel) return res.json({ count: 0 });
    const gruppen = await sammleGruppen(standardfelder);
    const g = gruppen.get(norm(name));
    if (!g) return res.json({ count: 0 });
    const notizen = await ladeNotizenFuer([...g.jobIds], [...g.exakteNamen]);
    let count = 0;
    for (const n of notizen) {
      if (istGefuellt(n._quellWert) && zielLeer(n, ziel)) count++;
    }
    res.json({ count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/vorqual-zuordnung/uebernehmen  body: { name, ziel_feld_id }
// Kopiert Werte ins Zielfeld (nur wo Ziel leer), entfernt den stellenspezifischen
// Schlüssel aus jeder Notiz und die Felddefinition aus jedem betroffenen Job.
router.post('/uebernehmen', requireAdmin, async (req, res) => {
  try {
    const name = String(req.body?.name ?? '').trim();
    const zielId = req.body?.ziel_feld_id;
    if (!name) return res.status(400).json({ error: 'Feldname fehlt.' });
    if (!zielId) return res.status(400).json({ error: 'Zielfeld fehlt (nicht zuordnen).' });

    const standardfelder = await ladeStandardfelder();
    const ziel = standardfelder.find(sf => String(sf.id) === String(zielId));
    if (!ziel) return res.status(404).json({ error: 'Zielfeld nicht gefunden.' });

    const gruppen = await sammleGruppen(standardfelder);
    const g = gruppen.get(norm(name));
    if (!g) return res.json({ kopiert: 0, stellen_bereinigt: 0, feldwerte_entfernt: 0 });

    const jobIds = [...g.jobIds];
    const exakteNamen = [...g.exakteNamen];

    // 1) Notizen durchgehen: kopieren (wenn Ziel leer) + Quell-Schlüssel entfernen.
    const { data: bews = [] } = await supabase
      .from('talentone_bewerbungen').select('id').in('job_id', jobIds);
    const bewIds = (bews || []).map(b => b.id);

    let kopiert = 0, feldwerteEntfernt = 0;
    for (let i = 0; i < bewIds.length; i += 500) {
      const teil = bewIds.slice(i, i + 500);
      const { data: notizen = [] } = await supabase
        .from('talentone_bewerber_notizen')
        .select('bewerbung_id, vorqualifizierung_werte, gehaltswunsch, verfuegbarkeit')
        .in('bewerbung_id', teil);
      for (const notiz of notizen || []) {
        const werte = (notiz.vorqualifizierung_werte && typeof notiz.vorqualifizierung_werte === 'object')
          ? { ...notiz.vorqualifizierung_werte } : {};
        // Quell-Wert (erster gefüllter exakter Name)
        let quellWert = '';
        let hatQuellSchluessel = false;
        for (const en of exakteNamen) {
          if (en in werte) hatQuellSchluessel = true;
          if (!quellWert && istGefuellt(werte[en])) quellWert = werte[en];
        }
        const patch = {};
        let aenderung = false;

        // Kopieren, falls Quelle gefüllt + Ziel leer
        if (istGefuellt(quellWert) && zielLeer(notiz, ziel)) {
          if (ziel.notiz_feld) {
            patch[ziel.notiz_feld] = String(quellWert);
          } else {
            werte[ziel.std_key] = quellWert;
          }
          kopiert++;
          aenderung = true;
        }
        // Quell-Schlüssel entfernen
        if (hatQuellSchluessel) {
          for (const en of exakteNamen) delete werte[en];
          feldwerteEntfernt++;
          aenderung = true;
        }
        if (!aenderung) continue;
        patch.vorqualifizierung_werte = werte;
        patch.updated_at = new Date().toISOString();
        const { error: upErr } = await supabase
          .from('talentone_bewerber_notizen')
          .update(patch)
          .eq('bewerbung_id', notiz.bewerbung_id);
        if (upErr) throw new Error(upErr.message);
      }
    }

    // 2) Felddefinition aus jedem betroffenen Job entfernen.
    let stellenBereinigt = 0;
    const { data: jobs = [] } = await supabase
      .from('talentone_jobs').select('id, vorqualifizierung_felder').in('id', jobIds);
    for (const job of jobs || []) {
      const felder = Array.isArray(job?.vorqualifizierung_felder) ? job.vorqualifizierung_felder : [];
      const gefiltert = felder.filter(f => !(f && typeof f === 'object' && norm(f.name) === norm(name)));
      if (gefiltert.length === felder.length) continue;
      const { error: jErr } = await supabase
        .from('talentone_jobs').update({ vorqualifizierung_felder: gefiltert }).eq('id', job.id);
      if (jErr) throw new Error(jErr.message);
      stellenBereinigt++;
    }

    res.json({ kopiert, stellen_bereinigt: stellenBereinigt, feldwerte_entfernt: feldwerteEntfernt });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
