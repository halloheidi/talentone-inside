// Aggregations-Kern für das Heute-Dashboard (/api/heute). Ruft BESTEHENDE Wächter/
// Reminder-Funktionen auf (keine Neuberechnung): Cockpit-Overview (bewerteZeile),
// Kampagnen-Reminder, plus fokussierte Queries für Bewerber/Feedback/Uploads sowie
// Close (Tasks) und Instantly (read-only). Jeder Collector ist best-effort gekapselt.

import { supabase } from './supabase.js';
import { computeOpsOverview } from './routes/controlling-ops.js';
import { ermittleFaelligeKampagnen } from './campaign-reminder.js';
import { listOpenTasksSplit, listUsers, getCloseKey } from './close.js';
import { getInstantlyOverview } from './instantly.js';
import { callClaudeWithRetry } from './claude.js';
import { sslProbleme } from './ssl-watchdog.js';

const DAY = 86400000;
const CLAUDE_MODEL = 'claude-sonnet-4-6';
const heuteStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const tageSeit = (iso) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / DAY) : null;

async function chunkedIn(table, col, ids, select) {
  const out = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await supabase.from(table).select(select).in(col, ids.slice(i, i + 150));
    out.push(...(data || []));
  }
  return out;
}

/* ═══════════ 🔴 Kritisch — aus dem Operativen Cockpit (bewerteZeile) ═══════════ */
// Rote Ampeln (Zahlungsproblem, Garantie überzogen, 0 Bewerbungen, überfällig, CPL)
// + die gelben Wächter garantie_knapp/budget (unter Schwelle / Budget-Überschreitung).
const GELB_WAECHTER = new Set(['garantie_knapp', 'budget']);

async function collectKritisch() {
  const ov = await computeOpsOverview({ status: 'live' });
  const rows = ov.rows || [];
  const items = [];
  for (const r of rows) {
    const gruende = r.ampel_gruende || [];
    const link = `/kunden/${r.kunde_id}`;
    if (r.ampel === 'rot') {
      items.push({
        key: `kritisch:projekt:${r.projekt_id}`,
        section: 'kritisch', severity: 'kritisch',
        title: `${r.kunde} — ${r.stelle}`,
        meta: gruende.map(g => g.label).join(' · ') || 'Rote Ampel',
        gruende: gruende.map(g => ({ code: g.code, label: g.label, stufe: g.stufe })),
        link, age_days: r.cockpit?.ueberfaellig_tage ?? r.letzte_bewerbung_tage ?? 0,
      });
    } else {
      const watch = gruende.filter(g => GELB_WAECHTER.has(g.code));
      if (watch.length) {
        items.push({
          key: `kritisch:watch:${r.projekt_id}`,
          section: 'kritisch', severity: 'hinweis',
          title: `${r.kunde} — ${r.stelle}`,
          meta: watch.map(g => g.label).join(' · '),
          gruende: watch.map(g => ({ code: g.code, label: g.label, stufe: g.stufe })),
          link, age_days: r.cockpit?.garantie_rest != null ? Math.max(0, 14 - r.cockpit.garantie_rest) : 0,
        });
      }
    }
  }
  return items;
}

// Zahlungsproblem-Werbekonten direkt aus dem bestehenden Flag (meta-sync schreibt
// talentone_meta_konten.zahlungsproblem). Fängt auch nicht-projektgebundene bzw.
// pausierte Konten ab, die als Projekt-Ampel nicht auftauchen (z. B. Sammelkonto).
async function collectZahlungsprobleme() {
  const { data } = await supabase.from('talentone_meta_konten')
    .select('konto_id, name, zahlungsproblem_seit, kunde_id').eq('zahlungsproblem', true);
  const kids = [...new Set((data || []).map(k => k.kunde_id).filter(Boolean))];
  const kmap = new Map((kids.length ? await chunkedIn('talentone_kunden', 'id', kids, 'id, firmenname') : []).map(k => [k.id, k]));
  return (data || []).map(k => ({
    key: `kritisch:zahlung:${k.konto_id}`,
    section: 'kritisch', severity: 'kritisch',
    title: `Zahlungsproblem — Werbekonto „${k.name || k.konto_id}"${k.kunde_id ? ` (${kmap.get(k.kunde_id)?.firmenname || ''})` : ''}`,
    meta: `Meta-Konto meldet ein Zahlungsproblem${k.zahlungsproblem_seit ? ` seit ${k.zahlungsproblem_seit}` : ''} — Zahlungsmethode prüfen`,
    link: k.kunde_id ? `/kunden/${k.kunde_id}` : '/controlling',
    age_days: k.zahlungsproblem_seit ? (tageSeit(k.zahlungsproblem_seit + 'T00:00:00Z') || 0) : 0,
  }));
}

/* ═══════════ 📋 Kampagnen heute ═══════════ */
async function collectKampagnen() {
  const items = [];
  const heute = heuteStr();

  // (1) Projekte mit heutigem geplanten Livegang (noch nicht gestartet).
  try {
    const { data: live } = await supabase.from('talentone_projekte')
      .select('id, kunde_id, kunde, geplanter_livegang, start_phase1, status')
      .eq('geplanter_livegang', heute).is('start_phase1', null);
    for (const p of live || []) {
      if (/beend|abgeschloss|storn|verloren|abgesagt|archiv/i.test(p.status || '')) continue;
      items.push({
        key: `kampagne:livegang:${p.id}`, section: 'kampagnen', severity: 'heute',
        title: `${p.kunde || 'Projekt'} — geplanter Livegang heute`,
        meta: 'Soll-Livegang ist heute — bereit zum Schalten?',
        link: `/kunden/${p.kunde_id}`, age_days: 0,
      });
    }
  } catch (e) { console.warn('[heute] livegang:', e.message); }

  // (2) Wartende Kunden-Freigaben > 3 Tage (Review offen; Logik wie entwurfs-reminder,
  //     aber 3-Tage-Cutoff). Neuester Versand je Job gegen offenen Review.
  try {
    const cut = new Date(Date.now() - 3 * DAY).toISOString();
    const { data: versand } = await supabase.from('talentone_versand')
      .select('job_id, typ, created_at')
      .or('typ.like.entwurf_runde_%,typ.like.update_runde_%')
      .lt('created_at', cut).order('created_at', { ascending: false });
    const letzterJeJob = new Map();
    for (const v of versand || []) if (!letzterJeJob.has(v.job_id)) letzterJeJob.set(v.job_id, v);
    const jobIds = [...letzterJeJob.keys()];
    if (jobIds.length) {
      const reviews = await chunkedIn('talentone_reviews', 'job_id', jobIds,
        'job_id, status, runde, manuell_beantwortet, reminder_intern_gesendet_at');
      const revBest = new Map();
      for (const rv of reviews) {
        const cur = revBest.get(rv.job_id);
        if (!cur || (rv.runde || 0) > (cur.runde || 0)) revBest.set(rv.job_id, rv);
      }
      const jobs = await chunkedIn('talentone_jobs', 'id', jobIds, 'id, kunde_id, stelle');
      const jobMap = new Map(jobs.map(j => [j.id, j]));
      for (const [jobId, v] of letzterJeJob) {
        const rv = revBest.get(jobId);
        if (!rv || rv.status !== 'offen' || rv.manuell_beantwortet) continue;
        const j = jobMap.get(jobId); if (!j) continue;
        items.push({
          key: `kampagne:freigabe:${jobId}`, section: 'kampagnen', severity: 'heute',
          title: `${j.stelle || 'Stelle'} — Freigabe ausstehend`,
          meta: `Entwürfe seit ${tageSeit(v.created_at)} Tagen beim Kunden ohne Reaktion`,
          link: `/kunden/${j.kunde_id}/jobs/${jobId}/export`, age_days: tageSeit(v.created_at) || 0,
        });
      }
    }
  } catch (e) { console.warn('[heute] freigaben:', e.message); }

  // (3) 30/60/90-Tage-Reminder, die heute fällig sind (bestehende Funktion).
  try {
    const faellig = await ermittleFaelligeKampagnen(new Date());
    for (const f of faellig || []) {
      items.push({
        key: `kampagne:reminder:${f.projekt?.id}:${f.meilenstein}`, section: 'kampagnen', severity: 'heute',
        title: `${f.projekt?.kunde || f.job?.stelle || 'Kampagne'} — ${f.meilenstein}-Tage-Reminder`,
        meta: `Kampagne läuft ${f.lauftage} Tage (${f.modus}) — Meilenstein ${f.meilenstein} erreicht`,
        link: `/kunden/${f.projekt?.kunde_id || ''}`, age_days: 0,
      });
    }
  } catch (e) { console.warn('[heute] kampagnen-reminder:', e.message); }

  // (4) Eingegangene Uploads (Logo/Fotos/Dokumente) der letzten 24h.
  try {
    const seit24 = new Date(Date.now() - DAY).toISOString();
    const { data: ups } = await supabase.from('talentone_upload_benachrichtigung')
      .select('kunde_id, letzter_upload_at, dateien').gte('letzter_upload_at', seit24);
    const kids = [...new Set((ups || []).map(u => u.kunde_id).filter(Boolean))];
    const kmap = new Map((await chunkedIn('talentone_kunden', 'id', kids, 'id, firmenname')).map(k => [k.id, k]));
    for (const u of ups || []) {
      const anzahl = Array.isArray(u.dateien) ? u.dateien.length : (u.dateien ? 1 : 0);
      items.push({
        key: `kampagne:upload:${u.kunde_id}`, section: 'kampagnen', severity: 'heute',
        title: `${kmap.get(u.kunde_id)?.firmenname || 'Kunde'} — neue Uploads`,
        meta: `${anzahl || ''} Datei(en) in den letzten 24h hochgeladen`.trim(),
        link: `/kunden/${u.kunde_id}`, age_days: 0,
      });
    }
  } catch (e) { console.warn('[heute] uploads:', e.message); }

  return items;
}

/* ═══════════ 👥 Bewerber-Aktionen ═══════════ */
async function collectBewerber() {
  const items = [];
  const seit24 = new Date(Date.now() - DAY).toISOString();
  const since14 = new Date(Date.now() - 14 * DAY).toISOString();

  // (1) Neue Bewerbungen ohne Telefonisten-Status (>24h alt), Anzahl je Job.
  try {
    const { data: bews } = await supabase.from('talentone_bewerbungen')
      .select('id, job_id, created_at').lt('created_at', seit24).gte('created_at', since14);
    const ids = (bews || []).map(b => b.id);
    const notizen = ids.length ? await chunkedIn('talentone_bewerber_notizen', 'bewerbung_id', ids, 'bewerbung_id, status') : [];
    const notizMap = new Map(notizen.map(n => [n.bewerbung_id, n]));
    const perJob = new Map(); // job_id → { count, oldest }
    for (const b of bews || []) {
      const n = notizMap.get(b.id);
      const status = n?.status || 'neu';
      if (status !== 'neu') continue; // bereits vom Telefonisten angefasst
      const cur = perJob.get(b.job_id) || { count: 0, oldest: b.created_at };
      cur.count += 1;
      if (b.created_at < cur.oldest) cur.oldest = b.created_at;
      perJob.set(b.job_id, cur);
    }
    const jobIds = [...perJob.keys()];
    const jobs = jobIds.length ? await chunkedIn('talentone_jobs', 'id', jobIds, 'id, kunde_id, stelle') : [];
    const jobMap = new Map(jobs.map(j => [j.id, j]));
    for (const [jobId, agg] of perJob) {
      const j = jobMap.get(jobId); if (!j) continue;
      items.push({
        key: `bewerber:offen:${jobId}`, section: 'bewerber', severity: 'hinweis',
        title: `${j.stelle || 'Stelle'} — ${agg.count} neue Bewerbung(en) offen`,
        meta: `Ohne Telefonisten-Status, älteste seit ${tageSeit(agg.oldest)} Tagen`,
        link: `/bewerbungen`, age_days: tageSeit(agg.oldest) || 1,
      });
    }
  } catch (e) { console.warn('[heute] bewerber-offen:', e.message); }

  // (2) Kundenfeedback der letzten 24h (Digest je Kunde/Status).
  try {
    const { data: fbs } = await supabase.from('talentone_bewerber_kundenfeedback')
      .select('bewerbung_id, status, updated_at').gte('updated_at', seit24);
    const bewIds = [...new Set((fbs || []).map(f => f.bewerbung_id))];
    const bews = bewIds.length ? await chunkedIn('talentone_bewerbungen', 'id', bewIds, 'id, job_id') : [];
    const jobIds = [...new Set(bews.map(b => b.job_id).filter(Boolean))];
    const jobs = jobIds.length ? await chunkedIn('talentone_jobs', 'id', jobIds, 'id, kunde_id, stelle') : [];
    const bewJob = new Map(bews.map(b => [b.id, b.job_id]));
    const jobKunde = new Map(jobs.map(j => [j.id, j.kunde_id]));
    const kids = [...new Set(jobs.map(j => j.kunde_id).filter(Boolean))];
    const kmap = new Map((await chunkedIn('talentone_kunden', 'id', kids, 'id, firmenname')).map(k => [k.id, k]));
    const perKunde = new Map(); // kunde_id → { [status]: n }
    for (const f of fbs || []) {
      const kid = jobKunde.get(bewJob.get(f.bewerbung_id));
      if (!kid) continue;
      const m = perKunde.get(kid) || {};
      m[f.status] = (m[f.status] || 0) + 1;
      perKunde.set(kid, m);
    }
    for (const [kid, counts] of perKunde) {
      const txt = Object.entries(counts).map(([s, n]) => `${n}× ${s}`).join(', ');
      items.push({
        key: `bewerber:feedback:${kid}:${heuteStr()}`, section: 'bewerber', severity: 'hinweis',
        title: `${kmap.get(kid)?.firmenname || 'Kunde'} — Kundenfeedback (24h)`,
        meta: txt, link: `/bewerbungen`, age_days: 0,
      });
    }
  } catch (e) { console.warn('[heute] feedback-digest:', e.message); }

  // (3) „eingestellt" (Kunde) ohne erfasste Einstellung im Projekt.
  try {
    const seit60 = new Date(Date.now() - 60 * DAY).toISOString();
    const { data: fbs } = await supabase.from('talentone_bewerber_kundenfeedback')
      .select('bewerbung_id, updated_at').eq('status', 'eingestellt').gte('updated_at', seit60);
    const bewIds = [...new Set((fbs || []).map(f => f.bewerbung_id))];
    if (bewIds.length) {
      const bews = await chunkedIn('talentone_bewerbungen', 'id', bewIds, 'id, name, job_id');
      const jobIds = [...new Set(bews.map(b => b.job_id).filter(Boolean))];
      const jobs = jobIds.length ? await chunkedIn('talentone_jobs', 'id', jobIds, 'id, kunde_id, projekt_id, stelle') : [];
      const jobMap = new Map(jobs.map(j => [j.id, j]));
      const projIds = [...new Set(jobs.map(j => j.projekt_id).filter(Boolean))];
      const projekte = projIds.length ? await chunkedIn('talentone_projekte', 'id', projIds, 'id, kunde_id, phase1_einstellungen, phase2_einstellungen') : [];
      const projMap = new Map(projekte.map(p => [p.id, p]));
      for (const b of bews) {
        const j = jobMap.get(b.job_id); if (!j) continue;
        const p = j.projekt_id ? projMap.get(j.projekt_id) : null;
        const erfasst = `${p?.phase1_einstellungen || ''}\n${p?.phase2_einstellungen || ''}`.toLowerCase();
        const name = (b.name || '').trim().toLowerCase();
        const schonErfasst = name && erfasst.includes(name);
        if (schonErfasst) continue;
        items.push({
          key: `bewerber:einstellung-fehlt:${b.id}`, section: 'bewerber', severity: 'hinweis',
          title: `${b.name || 'Bewerber'} — als „eingestellt" gemeldet, aber nicht erfasst`,
          meta: `${j.stelle || ''} — Einstellung im Projekt nachtragen`,
          link: `/kunden/${j.kunde_id}`, age_days: tageSeit(b.updated_at) || 0,
        });
      }
    }
  } catch (e) { console.warn('[heute] einstellung-gap:', e.message); }

  return items;
}

/* ═══════════ ✅ Close-Tasks des Nutzers ═══════════ */
async function collectClose(userEmail) {
  if (!(await getCloseKey())) return { configured: false, tasks: [], total_offen: 0, hinweis: 'CLOSE_API_KEY nicht hinterlegt.' };
  try {
    const users = await listUsers();
    const me = users.find(u => (u.email || '').toLowerCase() === (userEmail || '').toLowerCase());
    if (!me) return { configured: true, tasks: [], total_offen: 0, hinweis: `Kein Close-User mit E-Mail ${userEmail} gefunden.` };
    const { faellig, total } = await listOpenTasksSplit({ closeUserId: me.id });
    return { configured: true, close_user: { id: me.id, name: me.name }, tasks: faellig, total_offen: total };
  } catch (e) {
    console.warn('[heute] close:', e.message);
    return { configured: true, tasks: [], total_offen: 0, error: e.message };
  }
}

/* ═══════════ ✉️ Instantly ═══════════ */
async function collectInstantly() {
  try { return await getInstantlyOverview(); }
  catch (e) { return { configured: true, error: e.message, unibox_url: 'https://app.instantly.ai/app/unibox', kampagnen: [] }; }
}

/* ═══════════ 🤖 KI-Tagesbriefing (Deko über den Daten) ═══════════ */
const SEV_RANK = { kritisch: 0, heute: 1, hinweis: 2 };

function sortierItems(items) {
  return [...items].sort((a, b) => {
    if (SEV_RANK[a.severity] !== SEV_RANK[b.severity]) return SEV_RANK[a.severity] - SEV_RANK[b.severity];
    return (b.age_days || 0) - (a.age_days || 0);
  });
}

function deterministischesBriefing(alleItems, close, instantly) {
  const k = alleItems.filter(i => i.severity === 'kritisch').length;
  const h = alleItems.filter(i => i.severity === 'heute').length;
  const closeN = (close.tasks || []).length;
  const top3 = sortierItems(alleItems).slice(0, 3).map(i => i.title);
  const satz = `${k} kritische Punkte, ${h} heute fällig${closeN ? `, ${closeN} Close-Tasks` : ''}.`;
  return { text: satz, top3 };
}

async function erzeugeBriefing(alleItems, close, instantly) {
  const fallback = deterministischesBriefing(alleItems, close, instantly);
  if (!process.env.ANTHROPIC_API_KEY || alleItems.length === 0) return fallback;
  try {
    const kompakt = sortierItems(alleItems).slice(0, 25).map(i => `- [${i.severity}] ${i.title} — ${i.meta}`).join('\n');
    const closeTxt = (close.tasks || []).length ? `\nClose-Tasks heute/überfällig: ${close.tasks.length}` : '';
    const instTxt = (instantly.kampagnen || []).length ? `\nInstantly aktive Kampagnen: ${instantly.kampagnen.length}` : '';
    const prompt = `Du bist ein nüchterner Operations-Assistent. Fasse die heutige Prioritätenliste eines Recruiting-/Leadgen-Dienstleisters in 3–5 kurzen deutschen Sätzen zusammen und nenne die Top-3-Prioritäten in Klartext (beginne mit "Heute zuerst:"). Triff KEINE Aussagen, die nicht in der Liste stehen. Keine Floskeln.

Liste:
${kompakt}${closeTxt}${instTxt}

Antworte als JSON: {"text": "<3-5 Sätze inkl. 'Heute zuerst: …'>", "top3": ["…","…","…"]}`;
    const resp = await callClaudeWithRetry({ model: CLAUDE_MODEL, max_tokens: 500, messages: [{ role: 'user', content: prompt }] });
    const raw = resp?.content?.[0]?.text || '';
    // Robust: nur das erste {...}-Objekt herausschneiden (Modell hängt bisweilen Prosa an).
    const slice = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    const json = JSON.parse(slice);
    if (json?.text) return { text: String(json.text), top3: Array.isArray(json.top3) ? json.top3.slice(0, 3) : fallback.top3 };
    return fallback;
  } catch (e) {
    console.warn('[heute] briefing:', e.message);
    return fallback;
  }
}

/* ═══════════ Haupt-Aggregator ═══════════ */
export async function buildHeute({ userEmail }) {
  const [ssl, kritischCockpit, zahlung, kampagnen, bewerber, close, instantly] = await Promise.all([
    sslProbleme().then(list => list.map(s => ({
      key: `kritisch:ssl:${s.host}`, section: 'kritisch', severity: 'kritisch',
      title: `🔒 SSL-Problem — ${s.host}`, meta: `${s.grund} (geprüft ${s.checked_at ? new Date(s.checked_at).toLocaleString('de-DE') : '—'}) — Webhooks/OAuth/Portal betroffen`,
      link: null, age_days: 0,
    }))).catch(() => []),
    collectKritisch().catch(e => { console.warn('[heute] kritisch:', e.message); return []; }),
    collectZahlungsprobleme().catch(e => { console.warn('[heute] zahlung:', e.message); return []; }),
    collectKampagnen().catch(e => { console.warn('[heute] kampagnen:', e.message); return []; }),
    collectBewerber().catch(e => { console.warn('[heute] bewerber:', e.message); return []; }),
    collectClose(userEmail),
    collectInstantly(),
  ]);

  // SSL-/Infrastruktur-Probleme ganz oben, dann Zahlungsprobleme, dann Cockpit-Ampeln.
  const seen = new Set();
  const kritisch = [...ssl, ...zahlung, ...kritischCockpit].filter(i => !seen.has(i.key) && seen.add(i.key));
  const alleItems = [...kritisch, ...kampagnen, ...bewerber];
  const briefing = await erzeugeBriefing(alleItems, close, instantly);

  return {
    generated_at: new Date().toISOString(),
    briefing,
    sections: {
      kritisch: sortierItems(kritisch),
      kampagnen: sortierItems(kampagnen),
      bewerber: sortierItems(bewerber),
    },
    close,
    instantly,
    counts: {
      kritisch: kritisch.filter(i => i.severity === 'kritisch').length,
      heute: kampagnen.length,
      hinweise: bewerber.length + kritisch.filter(i => i.severity === 'hinweis').length,
      close: (close.tasks || []).length,
      instantly: (instantly.kampagnen || []).length,
    },
  };
}
