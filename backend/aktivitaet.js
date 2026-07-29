// Gemeinsamer Aktivitäts-Service eines Jobs/Projekts.
// Aggregiert Versand-Log, Reviews (Feedback/Freigabe/manuell), Creatives, Funnel,
// interne Projekt-Notizen und die AVV-Annahme zu EINER chronologischen Event-Liste
// (neueste zuerst). Quelle für die konsolidierte Timeline im Export-Tab (Punkt 2)
// und die "Zuletzt passiert"-Zeile im Projekt-Kopf (Punkt 3).
//
// Jedes Event: { id, kind, icon, at, titel, detail?, kommentare?: [{label, text}] }

import { supabase } from './supabase.js';
import { getAnnahme } from './avv.js';

function versandEvent(v) {
  const typ = v.typ || 'entwurf';
  let icon = '📤';
  let titel = 'Versand an Kunden';
  let m;
  if ((m = /^entwurf_runde_(\d+)$/.exec(typ)))       { icon = '📤'; titel = `Entwürfe verschickt (Runde ${m[1]})`; }
  else if ((m = /^entwurf_resend_(\d+)$/.exec(typ)))  { icon = '↩️'; titel = `Entwürfe erneut verschickt (Runde ${m[1]})`; }
  else if ((m = /^update_runde_(\d+)$/.exec(typ)))    { icon = '📬'; titel = `Kampagnen-Update verschickt (Update ${m[1]})`; }
  else if (typ === 'entwurf_reminder')               { icon = '⏰'; titel = 'Reminder an Kunden'; }
  else if (typ === 'daten_pruefung')                 { icon = '📋'; titel = 'Daten-Prüfung an Kunden geschickt'; }
  else if (typ === 'reaktivierung')                  { icon = '🔔'; titel = 'Reaktivierung an Kunden'; }
  else if (typ === 'kampagne_live')                  { icon = '🚀'; titel = 'Kampagne-Live gemeldet'; }
  else if (typ === 'kampagne_pause')                 { icon = '⏸️'; titel = 'Kampagne pausiert (Kunde informiert)'; }
  else if (typ === 'termin_einladung')               { icon = '📅'; titel = 'Termin-Einladung verschickt'; }
  else                                               { icon = '📤'; titel = 'Entwürfe verschickt'; }
  return {
    id: `versand_${v.id}`,
    kind: 'versand',
    icon,
    at: v.created_at,
    titel,
    detail: v.betreff ? `Betreff: ${v.betreff}` : (v.empfaenger ? `An: ${v.empfaenger}` : null),
  };
}

// Kommentare einer Review-Runde in eine anzeigbare Liste [{label, text}] umwandeln.
function extractKommentare(r) {
  const k = r.kommentare || {};
  const snap = r.kommentare_snapshot || {};
  const out = [];
  for (const [key, raw] of Object.entries(k)) {
    const text = raw == null ? '' : String(raw);
    if (!text.trim()) continue;
    let label = 'Allgemein';
    if (key === 'general') label = 'Allgemein';
    else if (key === 'funnel') label = 'Funnel';
    else if (key.startsWith('creative_')) {
      const s = snap[key];
      label = s ? `Creative (${[s.format, s.typ].filter(Boolean).join(' ')})` : 'Creative';
    } else if (key.startsWith('adcopy_')) {
      const s = snap[key];
      label = s?.stil ? `Ad-Copy (${s.stil})` : 'Ad-Copy';
    }
    out.push({ label, text });
  }
  return out;
}

function reviewEvents(reviews) {
  const out = [];
  for (const r of reviews) {
    if (!r || r.runde === 0) continue; // runde 0 = interner Reminder-Stub, kein Kunden-Event
    const isUpdate = r.kontext === 'update';
    const label = isUpdate ? `Update ${r.runde}` : `Runde ${r.runde}`;
    const komm = extractKommentare(r);
    const at = r.updated_at || r.created_at;
    if (r.status === 'freigegeben') {
      out.push({
        id: `review_${r.id}_frei`, kind: 'freigabe', icon: '✅', at,
        titel: isUpdate ? `Update freigegeben (${label})` : `Entwürfe freigegeben (${label})`,
        kommentare: komm.length ? komm : undefined,
      });
    } else if (r.status === 'aenderungen') {
      out.push({
        id: `review_${r.id}_aend`, kind: 'feedback', icon: '📝', at,
        titel: `Kundenfeedback: Änderungswünsche (${label})`,
        kommentare: komm.length ? komm : undefined,
      });
    }
    if (r.manuell_beantwortet) {
      out.push({
        id: `review_${r.id}_manuell`, kind: 'manuell', icon: '✍️', at,
        titel: `Kunde hat anderweitig geantwortet (${label})`,
        detail: r.manuell_notiz || null,
      });
    }
  }
  return out;
}

// Creatives eines Generierungs-Schubs (aufeinanderfolgend, Lücke ≤ 30 Min) zu
// EINEM Event bündeln — sonst überfluten Einzel-Creatives die Timeline.
function creativeEvents(creatives) {
  const GAP_MS = 30 * 60 * 1000;
  const sorted = (creatives || [])
    .filter(c => c.created_at)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const clusters = [];
  for (const c of sorted) {
    const ts = new Date(c.created_at).getTime();
    const last = clusters[clusters.length - 1];
    if (last && ts - last.lastTs <= GAP_MS) {
      last.count++; last.lastTs = ts; last.at = c.created_at;
    } else {
      clusters.push({ at: c.created_at, firstTs: ts, lastTs: ts, count: 1 });
    }
  }
  return clusters.map((g, i) => ({
    id: `creatives_${g.firstTs}_${i}`,
    kind: 'creatives',
    icon: '🎨',
    at: g.at,
    titel: g.count > 1 ? `${g.count} Creatives erstellt` : 'Creative erstellt',
  }));
}

export async function buildAktivitaet(jobId) {
  const { data: job } = await supabase
    .from('talentone_jobs').select('id, kunde_id').eq('id', jobId).maybeSingle();
  if (!job) return [];
  const kundeId = job.kunde_id;

  const [versandR, reviewsR, creativesR, funnelsR] = await Promise.all([
    supabase.from('talentone_versand')
      .select('id, created_at, typ, betreff, empfaenger, inhalte').eq('job_id', jobId),
    supabase.from('talentone_reviews')
      .select('id, created_at, updated_at, runde, kontext, status, kommentare, kommentare_snapshot, manuell_beantwortet, manuell_notiz')
      .eq('job_id', jobId),
    supabase.from('talentone_creatives')
      .select('id, created_at, format, typ').eq('job_id', jobId).neq('archiviert', true),
    supabase.from('talentone_funnels')
      .select('id, created_at').eq('job_id', jobId),
  ]);

  const events = [];
  for (const v of (versandR.data || [])) events.push(versandEvent(v));
  events.push(...reviewEvents(reviewsR.data || []));
  events.push(...creativeEvents(creativesR.data || []));
  for (const f of (funnelsR.data || [])) {
    events.push({ id: `funnel_${f.id}`, kind: 'funnel', icon: '🧩', at: f.created_at, titel: 'Funnel gebaut' });
  }

  // Interne Projekt-Notizen (quelle 'intern') — System-/Review-Kommentare sind bereits
  // über Versand/Reviews abgebildet und würden sonst doppeln.
  let projektId = null;
  if (kundeId) {
    const { data: projekt } = await supabase.from('talentone_projekte')
      .select('id').eq('kunde_id', kundeId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    projektId = projekt?.id || null;
  }
  if (projektId) {
    const { data: koms } = await supabase.from('talentone_kommentare')
      .select('id, created_at, autor, text, quelle').eq('projekt_id', projektId).in('quelle', ['intern', 'pruefung']);
    for (const k of (koms || [])) {
      if (k.quelle === 'pruefung') {
        events.push({
          id: `kom_${k.id}`, kind: 'pruefung', icon: '📋', at: k.created_at,
          titel: 'Kunde hat die Daten geprüft/ergänzt', detail: k.text || null,
        });
      } else {
        events.push({
          id: `kom_${k.id}`, kind: 'notiz', icon: '💬', at: k.created_at,
          titel: `Interne Notiz${k.autor ? ' — ' + k.autor : ''}`, detail: k.text || null,
        });
      }
    }
  }

  if (kundeId) {
    try {
      const ann = await getAnnahme(kundeId);
      if (ann?.akzeptiert_am) {
        events.push({
          id: `avv_${ann.id}`, kind: 'avv', icon: '📄', at: ann.akzeptiert_am,
          titel: `AVV angenommen${ann.version ? ' (v' + ann.version + ')' : ''}`,
          detail: ann.akzeptiert_von || null,
        });
      }
    } catch { /* AVV optional */ }
  }

  events.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
  return events;
}
