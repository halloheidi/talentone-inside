// Berechnet fuer jeden Kunden pro Job den "nächsten Schritt" im Workflow.
// Erste zutreffende Regel gewinnt. Wird von KundenList und KundeDetail
// als Badge angezeigt (Icon + Label + Farbe + Ziel-Tab).

import { supabase } from './supabase.js';
import { computeFotoLogoWarten, fotoLogoWartenLabel } from './foto-logo-warten.js';

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
  { key: 'update_feedback_offen',icon: '📬', label: 'Update-Feedback offen',      color: 'gelb',   tab: 'export' },
  { key: 'update_ueberarbeitung',icon: '🔄', label: 'Update-Überarbeitung',       color: 'gelb',   tab: 'export' },
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
 * ctx = { kunde, projekt, refbilderCount, hatFotos, hatLogo, fotoLogoWarten,
 *         versandTypen(Set), creativesCount, adcopiesCount, funnels, review,
 *         letzterEntwurfsversandDatum }
 */
function berechneSchritt(ctx) {
  const { kunde, projekt, tabStatus, refbilderCount, hatFotos, hatLogo, fotoLogoWarten,
          versandTypen, creativesCount, adcopiesCount, funnels, review, letzterEntwurfsversandDatum } = ctx;

  // Manuell abgehaktes Tab (tab_status[tab] === true) → zugehöriger Workflow-Schritt
  // wird übersprungen (Schritt wurde ausserhalb des Tools erledigt).
  const tabErledigt = (tab) => tabStatus && typeof tabStatus === 'object' && tabStatus[tab] === true;

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
    // Offenes Kampagnen-Update-Feedback hat Vorrang vor dem reinen Live-Badge —
    // die Farbe (gelb/rot) sorgt dafür, dass die Kundenliste es nach oben sortiert.
    const sub = projekt.update_feedback_status;
    if (sub === 'offen') {
      const seit = projekt.update_feedback_seit;
      const tage = seit ? Math.floor((Date.now() - new Date(seit).getTime()) / 86400000) : 0;
      return {
        ...REGEL_BY_KEY.update_feedback_offen,
        label: `Update-Feedback offen${tage ? ` (${tage}d)` : ''}`,
        color: tage >= 7 ? 'rot' : 'gelb',
      };
    }
    if (sub === 'ueberarbeitung') {
      return { ...REGEL_BY_KEY.update_ueberarbeitung };
    }
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

  // 2. Foto-/Logo-Logik — gemeinsame Quelle mit dem Kopf-Badge (fotoLogoWarten).
  //   a) Wenn Creatives existieren → Foto-Schritt komplett überspringen
  //      (wir haben ja offensichtlich ohne Kundenfotos gearbeitet).
  //   b) Angefragtes fehlt noch → ⏳ Warten auf Fotos/Logo/beides ({Datum})
  //   c) Noch nichts da und noch nichts angefragt → 📸 Fotos anfragen
  if (!tabErledigt('stelle') && creativesCount === 0) {
    if (fotoLogoWarten) {
      const wartet = { ...REGEL_BY_KEY.wartet_fotos, label: fotoLogoWartenLabel(fotoLogoWarten) };
      if (fotoLogoWarten.angefragt_am) {
        const datum = new Date(fotoLogoWarten.angefragt_am).toLocaleDateString('de-DE');
        wartet.label = `${fotoLogoWartenLabel(fotoLogoWarten)} (angefragt ${datum})`;
      }
      if (fotoLogoWarten.ueberfaellig) { wartet.icon = '⚠️'; wartet.color = 'rot'; }
      return wartet;
    }
    const anfrageRaus = versandTypen.has('anfrage') || !!kunde?.upload_token;
    if (!anfrageRaus && !hatFotos && !hatLogo && refbilderCount === 0) {
      return { ...REGEL_BY_KEY.fotos_anfragen };
    }
  }

  // 3. Keine Creatives
  if (!tabErledigt('creatives') && creativesCount === 0) return { ...REGEL_BY_KEY.creatives_erstellen };

  // 4. Keine Ad Copies
  if (!tabErledigt('adcopies') && adcopiesCount === 0) return { ...REGEL_BY_KEY.adcopies_erstellen };

  // 5. Kein Funnel
  const hatFunnel = funnels.some(f =>
    f.veroeffentlicht || (f.extern && f.extern_url));
  if (!tabErledigt('funnel') && !hatFunnel) return { ...REGEL_BY_KEY.funnel_verbinden };

  // 6. Keine Entwürfe verschickt?
  const hatEntwurfsversand = [...versandTypen].some(t => t.startsWith('entwurf_runde_'));
  if (!tabErledigt('export') && !hatEntwurfsversand) return { ...REGEL_BY_KEY.entwuerfe_verschicken };

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
    supabase.from('talentone_kunden').select('id, status, agentur, upload_token, logo_url').in('id', ids),
    supabase.from('talentone_projekte')
      .select('id, kunde_id, status, start_phase1, ende_phase1, projektdauer, created_at, update_feedback_status, update_feedback_seit')
      .in('kunde_id', ids).order('created_at', { ascending: false }),
    supabase.from('talentone_jobs')
      .select('id, kunde_id, stelle, created_at, tab_status').in('kunde_id', ids)
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
      ? supabase.from('talentone_versand').select('job_id, typ, created_at, inhalte').in('job_id', jobIds)
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
  const hatFotosByKunde = {};
  for (const r of refbilder) {
    refCountByKunde[r.kunde_id] = (refCountByKunde[r.kunde_id] || 0) + 1;
    if (r.typ !== 'logo') hatFotosByKunde[r.kunde_id] = true;
  }
  // Job → Kunde (für die kunde-weite Anfrage-Zuordnung)
  const kundeIdByJob = Object.fromEntries(jobs.map(j => [j.id, j.kunde_id]));

  const creativesCountByJob = {};
  for (const c of (creativesRes.data || [])) creativesCountByJob[c.job_id] = (creativesCountByJob[c.job_id] || 0) + 1;
  const adcopyCountByJob = {};
  for (const a of (adcopiesRes.data || [])) adcopyCountByJob[a.job_id] = (adcopyCountByJob[a.job_id] || 0) + 1;
  const funnelsByJob = {};
  for (const f of (funnelsRes.data || [])) (funnelsByJob[f.job_id] ||= []).push(f);
  const versandByJob = {};
  const entwurfsversandDatumByJob = {};
  const anfrageVersandByKunde = {}; // kunde-weit: neueste typ='anfrage' (inkl. inhalte.umfang)
  for (const v of (versandRes.data || [])) {
    (versandByJob[v.job_id] ||= []).push(v);
    if ((v.typ || '').startsWith('entwurf_runde_')) {
      const d = entwurfsversandDatumByJob[v.job_id];
      if (!d || v.created_at > d) entwurfsversandDatumByJob[v.job_id] = v.created_at;
    }
    if (v.typ === 'anfrage') {
      const kId = kundeIdByJob[v.job_id];
      const cur = anfrageVersandByKunde[kId];
      if (!cur || v.created_at > cur.created_at) anfrageVersandByKunde[kId] = v;
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

    const hatFotos = !!hatFotosByKunde[kId];
    const hatLogo = !!kunde?.logo_url;
    const fotoLogoWarten = computeFotoLogoWarten({
      anfrageVersand: anfrageVersandByKunde[kId] || null,
      uploadToken: kunde?.upload_token,
      hatLogo, hatFotos,
    });

    const items = kJobs.map(job => {
      const versandTypen = new Set((versandByJob[job.id] || []).map(v => v.typ));
      const schritt = berechneSchritt({
        kunde, projekt,
        tabStatus: job.tab_status,
        refbilderCount, hatFotos, hatLogo, fotoLogoWarten,
        versandTypen,
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
