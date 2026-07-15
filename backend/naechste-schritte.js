// Berechnet fuer jeden Kunden pro Job den "nächsten Schritt" im Workflow.
// Erste zutreffende Regel gewinnt. Wird von KundenList und KundeDetail
// als Badge angezeigt (Icon + Label + Farbe + Ziel-Tab).

import { supabase } from './supabase.js';

// Farb-Keys werden im Frontend auf konkrete CSS-Farben gemappt:
// - grau (wartet auf Kunde)
// - farbig (wir sind dran)
// - gruen (live)
// - gelb (überarbeitung nötig)
// - rot (warnung, überfällig)
// - dunkelgrau (abgeschlossen/pausiert)

const REGELN = [
  { key: 'wartet_formular',      icon: '⏳', label: 'Wartet auf Formular',        color: 'grau',   tab: 'stelle' },
  { key: 'fotos_anfragen',       icon: '📸', label: 'Fotos anfragen',             color: 'farbig', tab: 'stelle' },
  { key: 'wartet_fotos',         icon: '⏳', label: 'Wartet auf Fotos',           color: 'grau',   tab: 'stelle' },
  { key: 'creatives_erstellen',  icon: '🎨', label: 'Creatives erstellen',        color: 'farbig', tab: 'creatives' },
  { key: 'adcopies_erstellen',   icon: '✍️', label: 'Ad Copies erstellen',        color: 'farbig', tab: 'adcopies' },
  { key: 'funnel_verbinden',     icon: '🔗', label: 'Funnel verbinden',           color: 'farbig', tab: 'funnel' },
  { key: 'entwuerfe_verschicken',icon: '📤', label: 'Entwürfe verschicken',       color: 'farbig', tab: 'export' },
  { key: 'wartet_feedback',      icon: '⏳', label: 'Wartet auf Feedback',        color: 'grau',   tab: 'export' },
  { key: 'ueberarbeitung',       icon: '🔄', label: 'Überarbeitung nötig',        color: 'gelb',   tab: 'export' },
  { key: 'bereit_golive',        icon: '🚀', label: 'Bereit für Go-Live',         color: 'farbig', tab: 'export' },
  { key: 'live',                 icon: '🟢', label: 'Live',                       color: 'gruen',  tab: 'export' },
  { key: 'pausiert',             icon: '⏸️', label: 'Pausiert',                   color: 'dunkelgrau', tab: 'stelle' },
  { key: 'abgeschlossen',        icon: '✅', label: 'Abgeschlossen',              color: 'dunkelgrau', tab: 'stelle' },
];
const REGEL_BY_KEY = Object.fromEntries(REGELN.map(r => [r.key, r]));

// Stelle stark einkuerzen (erstes Wort oder ~15 Zeichen)
function kurznameFor(stelle) {
  if (!stelle) return 'Projekt';
  const s = String(stelle).trim();
  if (s.length <= 18) return s;
  const erstesWort = s.split(/[\s\/\-]/, 1)[0];
  if (erstesWort.length >= 4 && erstesWort.length <= 18) return erstesWort;
  return s.slice(0, 15) + '…';
}

/**
 * Ermittelt den nächsten Schritt für einen einzelnen Job.
 * ctx = { kunde, projekt, refbilderCount, versandTypen(Set),
 *         anfrageDatum (ISO oder null), creativesCount,
 *         adcopiesCount, funnels, review, letzterEntwurfsversandDatum }
 */
function berechneSchritt(ctx) {
  const { kunde, projekt, refbilderCount, versandTypen, anfrageDatum,
          creativesCount, adcopiesCount, funnels, review, letzterEntwurfsversandDatum } = ctx;

  // ══════════════════════════════════════════════════════════════════════
  // PROJEKT-STATUS HAT VORRANG:
  // Wenn der Projekt-Status ein "finaler" Zustand ist, zeigen wir DIESEN
  // Badge — egal was im Tool-Workflow (Fotos, Creatives, Ad Copies, Funnel)
  // noch fehlen mag. Rationale: eine Live-Kampagne braucht keinen
  // "Ad Copies erstellen"-Hinweis, denn sie ist ja bereits live —
  // Ad Copies wurden ggf. ausserhalb des Tools (direkt in Meta) erledigt.
  // Die Workflow-Pruefung greift NUR bei Aufbau-Status
  // (vorbereitung, onboarding, kickoff_vereinbart, golive_vereinbart,
  //  warte_auf_go, feedbackschleife) — also solange wir aktiv am Aufbau
  // arbeiten.
  // ══════════════════════════════════════════════════════════════════════
  if (projekt?.status === 'live') {
    const start = projekt.start_phase1;
    const ende  = projekt.ende_phase1;
    if (start) {
      const tag = Math.floor((Date.now() - new Date(start).getTime()) / 86400000);
      const heute = new Date(); heute.setHours(0, 0, 0, 0);
      const endeDate = ende ? new Date(ende) : null;
      const ueberfaellig = endeDate ? heute > endeDate : false;
      const endeStr = endeDate ? endeDate.toLocaleDateString('de-DE') : null;
      let label, color, icon;
      if (ueberfaellig) {
        label = `Live seit ${tag} Tagen — Laufzeit überschritten${endeStr ? ` (bis ${endeStr})` : ''}`;
        color = 'gelb'; icon = '🟡';
      } else if (endeStr) {
        label = `Live seit ${tag} Tagen (bis ${endeStr})`;
        color = 'gruen'; icon = '🟢';
      } else {
        label = `Live seit ${tag} Tagen`;
        color = 'gruen'; icon = '🟢';
      }
      return { ...REGEL_BY_KEY.live, label, tagX: tag, color, icon };
    }
    return { ...REGEL_BY_KEY.live };
  }
  if (projekt?.status === 'pausiert')     return { ...REGEL_BY_KEY.pausiert };
  if (projekt?.status === 'abgeschlossen') return { ...REGEL_BY_KEY.abgeschlossen };
  if (projekt?.status === 'go')            return { ...REGEL_BY_KEY.bereit_golive };

  // Kunde wartet auf Formular
  if (kunde?.status === 'wartend') return { ...REGEL_BY_KEY.wartet_formular };

  // 2. Foto-Logik — mit Skip-Regel bei bereits vorhandenen Creatives:
  //   a) Wenn Creatives existieren → Foto-Schritt komplett überspringen
  //      (wir haben ja offensichtlich ohne Kundenfotos gearbeitet).
  //   b) Sonst: keine Fotos + noch keine Anfrage → 📸 Fotos anfragen
  //   c) Sonst: keine Fotos + Anfrage bereits raus → ⏳ Wartet auf Fotos ({Datum})
  if (creativesCount === 0 && refbilderCount === 0) {
    // Anfrage-Nachweis: entweder Versand-Log ODER upload_token am Kunden
    // (der Token wird nur beim ersten anfrage-Aufruf generiert — deckt
    // Bestandsdaten ab, wo Versand-Log noch nicht mitgeschrieben wurde).
    const anfrageRaus = versandTypen.has('anfrage') || !!kunde?.upload_token;
    if (!anfrageRaus) {
      return { ...REGEL_BY_KEY.fotos_anfragen };
    }
    const wartet = { ...REGEL_BY_KEY.wartet_fotos };
    if (anfrageDatum) {
      const datum = new Date(anfrageDatum).toLocaleDateString('de-DE');
      wartet.label = `Wartet auf Fotos (angefragt ${datum})`;
      const tage = Math.floor((Date.now() - new Date(anfrageDatum).getTime()) / 86400000);
      if (tage >= 5) { wartet.icon = '⚠️'; wartet.color = 'rot'; }
    }
    return wartet;
  }

  // 3. Keine Creatives
  if (creativesCount === 0) return { ...REGEL_BY_KEY.creatives_erstellen };

  // 4. Keine Ad Copies
  if (adcopiesCount === 0) return { ...REGEL_BY_KEY.adcopies_erstellen };

  // 5. Kein Funnel
  const hatFunnel = funnels.some(f =>
    f.veroeffentlicht || (f.extern && f.extern_url));
  if (!hatFunnel) return { ...REGEL_BY_KEY.funnel_verbinden };

  // 6. Keine Entwürfe verschickt?
  const hatEntwurfsversand = [...versandTypen].some(t => t.startsWith('entwurf_runde_'));
  if (!hatEntwurfsversand) return { ...REGEL_BY_KEY.entwuerfe_verschicken };

  // 7-9. Review-Status
  if (review?.status === 'aenderungen') return { ...REGEL_BY_KEY.ueberarbeitung };
  if (review?.status === 'freigegeben') return { ...REGEL_BY_KEY.bereit_golive };

  // 7. Wartet auf Feedback (Entwürfe raus, keine Reaktion)
  const wartend = { ...REGEL_BY_KEY.wartet_feedback };
  if (letzterEntwurfsversandDatum) {
    const tage = Math.floor((Date.now() - new Date(letzterEntwurfsversandDatum).getTime()) / 86400000);
    wartend.label = `Wartet auf Feedback (${tage}d)`;
    if (tage >= 7) { wartend.icon = '⚠️'; wartend.color = 'rot'; }
  }
  return wartend;
}

/**
 * Sammelt in EINER Runde alle Daten fuer eine Menge von Kunden und liefert
 * pro Kunde eine Liste { job_id, stelle, kurzname, schritt } sortiert nach
 * Priorität (dringendste zuerst).
 */
export async function ermittleNaechsteSchritte(kundeIds) {
  const ids = Array.from(new Set((kundeIds || []).filter(Boolean)));
  if (!ids.length) return {};

  // Bulk-Loads
  const [kundenRes, projekteRes, jobsRes, refbilderRes] = await Promise.all([
    supabase.from('talentone_kunden').select('id, status, agentur, upload_token').in('id', ids),
    supabase.from('talentone_projekte')
      .select('id, kunde_id, status, start_phase1, ende_phase1, projektdauer, created_at')
      .in('kunde_id', ids).order('created_at', { ascending: false }),
    supabase.from('talentone_jobs')
      .select('id, kunde_id, stelle, created_at').in('kunde_id', ids)
      .order('created_at', { ascending: true }),
    supabase.from('talentone_referenzbilder')
      .select('kunde_id, typ').in('kunde_id', ids),
  ]);

  const kunden = kundenRes.data || [];
  const projekte = projekteRes.data || [];
  const jobs = jobsRes.data || [];
  const refbilder = refbilderRes.data || [];

  const jobIds = jobs.map(j => j.id);
  const [creativesRes, adcopiesRes, funnelsRes, versandRes, reviewsRes] = await Promise.all([
    jobIds.length
      ? supabase.from('talentone_creatives').select('job_id').in('job_id', jobIds)
      : { data: [] },
    jobIds.length
      ? supabase.from('talentone_adcopies').select('job_id').in('job_id', jobIds)
      : { data: [] },
    jobIds.length
      ? supabase.from('talentone_funnels').select('job_id, veroeffentlicht, extern, extern_url').in('job_id', jobIds)
      : { data: [] },
    jobIds.length
      ? supabase.from('talentone_versand').select('job_id, typ, created_at').in('job_id', jobIds)
      : { data: [] },
    jobIds.length
      ? supabase.from('talentone_reviews')
          .select('job_id, status, runde, manuell_beantwortet')
          .in('job_id', jobIds).order('runde', { ascending: false })
      : { data: [] },
  ]);

  // Indexieren
  const kundeById = Object.fromEntries(kunden.map(k => [k.id, k]));
  // Primaeres Projekt pro Kunde: Live/Pausiert/Abgeschlossen/Go > alles andere.
  // Innerhalb der gleichen Prio: juengstes zuerst (bereits per created_at DESC sortiert).
  const STATUS_PRIO = { live: 0, pausiert: 1, go: 2, abgeschlossen: 3 };
  const primaeresProjektByKunde = {};
  for (const p of projekte) {
    const cur = primaeresProjektByKunde[p.kunde_id];
    if (!cur) { primaeresProjektByKunde[p.kunde_id] = p; continue; }
    const curPrio = STATUS_PRIO[cur.status] ?? 99;
    const newPrio = STATUS_PRIO[p.status]  ?? 99;
    if (newPrio < curPrio) primaeresProjektByKunde[p.kunde_id] = p;
  }
  const refCountByKunde = {};
  for (const r of refbilder) refCountByKunde[r.kunde_id] = (refCountByKunde[r.kunde_id] || 0) + 1;

  const creativesCountByJob = {};
  for (const c of (creativesRes.data || [])) creativesCountByJob[c.job_id] = (creativesCountByJob[c.job_id] || 0) + 1;
  const adcopyCountByJob = {};
  for (const a of (adcopiesRes.data || [])) adcopyCountByJob[a.job_id] = (adcopyCountByJob[a.job_id] || 0) + 1;
  const funnelsByJob = {};
  for (const f of (funnelsRes.data || [])) (funnelsByJob[f.job_id] ||= []).push(f);
  const versandByJob = {};
  const entwurfsversandDatumByJob = {};
  const anfrageDatumByJob = {};
  for (const v of (versandRes.data || [])) {
    (versandByJob[v.job_id] ||= []).push(v);
    if ((v.typ || '').startsWith('entwurf_runde_')) {
      const d = entwurfsversandDatumByJob[v.job_id];
      if (!d || v.created_at > d) entwurfsversandDatumByJob[v.job_id] = v.created_at;
    }
    if (v.typ === 'anfrage') {
      const d = anfrageDatumByJob[v.job_id];
      if (!d || v.created_at > d) anfrageDatumByJob[v.job_id] = v.created_at;
    }
  }
  const reviewTopByJob = {};
  for (const r of (reviewsRes.data || [])) {
    if (!reviewTopByJob[r.job_id]) reviewTopByJob[r.job_id] = r;
  }

  // Bewerbungs-Fallback: wenn Kunde keine Jobs hat aber Projekt existiert
  // (Waisen — sollte nach Backfill nicht mehr passieren, aber sicherheitshalber)
  const out = {};
  for (const kId of ids) {
    const kunde = kundeById[kId];
    const projekt = primaeresProjektByKunde[kId];
    const kJobs = jobs.filter(j => j.kunde_id === kId);
    const refbilderCount = refCountByKunde[kId] || 0;

    if (!kJobs.length) {
      // Kein Job: Wenn Kunde wartet, ein Wartet-Formular-Badge. Sonst leer.
      if (kunde?.status === 'wartend') {
        out[kId] = [{
          job_id: null, stelle: '—', kurzname: 'Briefing',
          schritt: { ...REGEL_BY_KEY.wartet_formular },
        }];
      } else {
        out[kId] = [];
      }
      continue;
    }

    const items = kJobs.map(job => {
      const versandTypen = new Set((versandByJob[job.id] || []).map(v => v.typ));
      const schritt = berechneSchritt({
        kunde, projekt,
        refbilderCount,
        versandTypen,
        anfrageDatum: anfrageDatumByJob[job.id] || null,
        creativesCount: creativesCountByJob[job.id] || 0,
        adcopiesCount: adcopyCountByJob[job.id] || 0,
        funnels: funnelsByJob[job.id] || [],
        review: reviewTopByJob[job.id],
        letzterEntwurfsversandDatum: entwurfsversandDatumByJob[job.id] || null,
      });
      return {
        job_id: job.id,
        stelle: job.stelle || '—',
        kurzname: kurznameFor(job.stelle),
        schritt,
      };
    });

    // Sortierung nach Dringlichkeit: rot > gelb > farbig > gruen > grau > dunkelgrau
    const rank = { rot: 0, gelb: 1, farbig: 2, gruen: 3, grau: 4, dunkelgrau: 5 };
    items.sort((a, b) => (rank[a.schritt.color] ?? 9) - (rank[b.schritt.color] ?? 9));
    out[kId] = items;
  }
  return out;
}

/** Nur die aktive Untermenge (nicht pausiert/abgeschlossen), Fallback auf
 *  das Original wenn nur inaktive existieren. */
export function filterAktive(items) {
  if (!items?.length) return items || [];
  const aktive = items.filter(i =>
    i.schritt.key !== 'pausiert' && i.schritt.key !== 'abgeschlossen');
  return aktive.length ? aktive : items;
}
