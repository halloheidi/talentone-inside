// Meta Marketing API — Phase 1 (nur lesend: ads_read, read_insights).
// Fundament/Grundgerüst: Token-Verwaltung, Graph-Client, konto-weiser Sync von
// Kampagnen + Tages-Insights, nächtlicher Scheduler + manueller Trigger.
// Bleibt DORMANT, solange kein System-User-Token hinterlegt ist (getMetaToken()==null)
// — dann sauberer Skip, kein Fehler.
//
// Token-Quelle: talentone_settings.schluessel='meta_system_user_token' (bevorzugt,
// UI-editierbar) ODER env META_SYSTEM_USER_TOKEN. Beim Lesen IMMER trimmen
// (Leerzeichen in .env-Werten crashen sonst / verfälschen den Header).

import { supabase } from './supabase.js';

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
export const META_TOKEN_KEY = 'meta_system_user_token';

let running = false;
let lastRunAt = null;
let lastResult = null;

/** Liest den System-User-Token (Settings-Tabelle bevorzugt, sonst env). Getrimmt. */
export async function getMetaToken() {
  try {
    const { data } = await supabase.from('talentone_settings')
      .select('wert').eq('schluessel', META_TOKEN_KEY).maybeSingle();
    const ausDb = (data?.wert || '').trim();
    if (ausDb) return ausDb;
  } catch (e) { /* Tabelle evtl. noch nicht da → env-Fallback */ }
  const ausEnv = (process.env.META_SYSTEM_USER_TOKEN || '').trim();
  return ausEnv || null;
}

/** Speichert/löscht den Token in der Settings-Tabelle (nur serverseitig). */
export async function setMetaToken(token, updatedBy = null) {
  const wert = (token || '').trim() || null;
  const { error } = await supabase.from('talentone_settings')
    .upsert({ schluessel: META_TOKEN_KEY, wert, updated_at: new Date().toISOString(), updated_by: updatedBy },
      { onConflict: 'schluessel' });
  if (error) throw new Error(error.message);
  return { gesetzt: !!wert };
}

/** Ein einzelner Graph-Call. Wirft bei API-Fehler mit sprechender Meldung. */
async function graph(path, params, token) {
  const usp = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${GRAPH_BASE}/${path}?${usp.toString()}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.error) {
    const e = body?.error || {};
    throw new Error(`Graph ${res.status} (${e.code || '?'}/${e.error_subcode || '-'}): ${e.message || 'Unbekannt'}`);
  }
  return body;
}

/** Graph-Call mit Cursor-Paginierung (folgt paging.next), rate-limit-schonend. */
async function graphAll(path, params, token, maxPages = 25) {
  const out = [];
  let usp = new URLSearchParams({ ...params, access_token: token });
  let url = `${GRAPH_BASE}/${path}?${usp.toString()}`;
  for (let i = 0; i < maxPages && url; i++) {
    const res = await fetch(url);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.error) {
      const e = body?.error || {};
      throw new Error(`Graph ${res.status} (${e.code || '?'}): ${e.message || 'Unbekannt'}`);
    }
    if (Array.isArray(body.data)) out.push(...body.data);
    url = body.paging?.next || null;
    if (url) await sleep(350); // schonend zwischen Seiten
  }
  return out;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function ymd(d) { return new Date(d).toISOString().slice(0, 10); }

/** Distinct Werbekonten aus Projekt- und Job-Zuordnung (meta_werbekonto_id). */
function normKonto(id) {
  const s = String(id || '').trim();
  if (!s) return null;
  return s.startsWith('act_') ? s : `act_${s}`;
}

// Alle zu synchronisierenden Werbekonten: registrierte Konten (talentone_meta_konten,
// exklusiv + pool) plus Zuordnungen an Kunde/Projekt/Job (Robustheit/Alt-Bestand).
async function sammleWerbekonten() {
  const [konten, k, p, j] = await Promise.all([
    supabase.from('talentone_meta_konten').select('konto_id'),
    supabase.from('talentone_kunden').select('meta_werbekonto_id').not('meta_werbekonto_id', 'is', null),
    supabase.from('talentone_projekte').select('meta_werbekonto_id').not('meta_werbekonto_id', 'is', null),
    supabase.from('talentone_jobs').select('meta_werbekonto_id').not('meta_werbekonto_id', 'is', null),
  ]);
  const set = new Set();
  for (const r of (konten.data || [])) { const id = normKonto(r.konto_id); if (id) set.add(id); }
  for (const r of [...(k.data || []), ...(p.data || []), ...(j.data || [])]) {
    const id = normKonto(r.meta_werbekonto_id); if (id) set.add(id);
  }
  return [...set];
}

// Leads aus dem actions-Array bestmöglich ableiten (nur Referenz — die Wahrheit für
// CPL sind unsere talentone_bewerbungen, nicht Metas Lead-Zahl).
function leadsAusActions(actions) {
  if (!Array.isArray(actions)) return null;
  const leadTypes = new Set(['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead', 'leadgen.other']);
  let n = 0, gefunden = false;
  for (const a of actions) {
    if (leadTypes.has(a.action_type)) { n += Number(a.value) || 0; gefunden = true; }
  }
  return gefunden ? n : null;
}

/**
 * Discovery: alle sichtbaren Werbekonten des Tokens laden (/me/adaccounts).
 * Dient zugleich als Live-Token-Verifikation — wirft mit Klartext-Fehler.
 */
export async function ladeAdAccounts() {
  const token = await getMetaToken();
  if (!token) { const e = new Error('Kein Meta System User Token hinterlegt.'); e.code = 'kein_token'; throw e; }
  const accounts = await graphAll('me/adaccounts', {
    fields: 'account_id,id,name,account_status,currency', limit: '200',
  }, token);
  const statusLabel = { 1: 'aktiv', 2: 'deaktiviert', 3: 'ungenutzt', 7: 'ausstehende Prüfung', 8: 'in Prüfung', 9: 'Gnadenfrist', 101: 'geschlossen' };
  return accounts.map(a => ({
    konto_id: a.id,                                   // act_<id>
    name: a.name || a.id,
    account_status: a.account_status,
    status_label: statusLabel[a.account_status] || String(a.account_status ?? '—'),
    currency: a.currency || null,
  }));
}

/* ── Kampagnen-Namens-Matching (Pool + Exklusiv) ─────────────────────────────
   Attribution ist projekt_id-basiert. Regel: Kundenname-Substring priorisiert →
   Kunde bestimmen (Exklusiv-Konto: fest vorgegeben), dann eindeutigen Projekt-
   Treffer am Namen. Nur EINDEUTIGES wird automatisch gesetzt; Rest bleibt offen
   (sichtbar in der „Nicht zugeordnet"-Liste). Manuell gesetzte (projekt_id ≠ null)
   werden NIE überschrieben. */
function normName(s) {
  return String(s || '').toLowerCase()
    .replace(/\(\s*[mwdx](?:\s*\/\s*[mwdx])*\s*\)/g, ' ')
    .replace(/[^a-z0-9äöüß]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function nameTokens(s) { return new Set(normName(s).split(' ').filter(w => w.length >= 3)); }
function nameScore(a, b) {
  const ta = nameTokens(a), tb = nameTokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0; for (const t of ta) if (tb.has(t)) inter++;
  const na = normName(a), nb = normName(b);
  const sub = (na && nb && (na.includes(nb) || nb.includes(na))) ? 0.5 : 0;
  return inter / Math.max(ta.size, tb.size) + sub;
}
const NAME_SCHWELLE = 0.34, NAME_VORSPRUNG = 0.15;

function eindeutigBest(kandidaten, name, textOf) {
  const scored = kandidaten.map(c => ({ c, s: nameScore(name, textOf(c)) })).sort((x, y) => y.s - x.s);
  const best = scored[0], zweit = scored[1];
  if (best && best.s >= NAME_SCHWELLE && (best.s - (zweit?.s || 0)) >= NAME_VORSPRUNG) return best.c;
  return null;
}

export async function matchKampagnen() {
  // Nur noch nicht zugeordnete Kampagnen (projekt_id null) automatisch matchen.
  const { data: kampagnen } = await supabase.from('talentone_meta_kampagnen')
    .select('meta_campaign_id, name, werbekonto_id, projekt_id').is('projekt_id', null);
  if (!kampagnen?.length) return { geprueft: 0, zugeordnet: 0, offen: 0 };

  const [{ data: konten }, { data: kunden }, { data: kundenAcc }, { data: jobs }] = await Promise.all([
    supabase.from('talentone_meta_konten').select('konto_id, typ, kunde_id'),
    supabase.from('talentone_kunden').select('id, firmenname, meta_werbekonto_id'),
    supabase.from('talentone_kunden').select('id, meta_werbekonto_id').not('meta_werbekonto_id', 'is', null),
    supabase.from('talentone_jobs').select('id, stelle, kunde_id, projekt_id, projekttyp').not('projekt_id', 'is', null),
  ]);
  const kontoTyp = Object.fromEntries((konten || []).map(x => [normKonto(x.konto_id), x]));
  const exklusivKundeByKonto = {};
  for (const x of (konten || [])) if (x.typ === 'exklusiv' && x.kunde_id) exklusivKundeByKonto[normKonto(x.konto_id)] = x.kunde_id;
  for (const x of (kundenAcc || [])) { const kn = normKonto(x.meta_werbekonto_id); if (kn && !exklusivKundeByKonto[kn]) exklusivKundeByKonto[kn] = x.id; }

  const jobsByKunde = {};
  for (const j of (jobs || [])) if (j.projekttyp !== 'sonstiges' && j.projekttyp !== 'video') (jobsByKunde[j.kunde_id] ||= []).push(j);

  let zugeordnet = 0;
  for (const c of kampagnen) {
    const konto = normKonto(c.werbekonto_id);
    // Kunde bestimmen: Exklusiv-Konto → fest; sonst Namens-Match über alle Kunden.
    let kundeId = exklusivKundeByKonto[konto] || null;
    if (!kundeId) {
      const k = eindeutigBest(kunden || [], c.name, x => x.firmenname);
      kundeId = k?.id || null;
    }
    if (!kundeId) continue; // kein Kunde erkennbar → offen
    // Projekt (über einen verknüpften Job des Kunden) eindeutig am Namen finden.
    const jobKand = jobsByKunde[kundeId] || [];
    let projektId = null, jobId = null;
    if (jobKand.length === 1) { projektId = jobKand[0].projekt_id; jobId = jobKand[0].id; }
    else if (jobKand.length > 1) {
      const jb = eindeutigBest(jobKand, c.name, x => x.stelle);
      if (jb) { projektId = jb.projekt_id; jobId = jb.id; }
    }
    const patch = { kunde_id: kundeId, updated_at: new Date().toISOString() };
    if (projektId) { patch.projekt_id = projektId; patch.job_id = jobId; zugeordnet++; }
    await supabase.from('talentone_meta_kampagnen').update(patch).eq('meta_campaign_id', c.meta_campaign_id);
  }
  const offen = kampagnen.length - zugeordnet;
  console.log(`[meta-match] ${kampagnen.length} geprüft, ${zugeordnet} zugeordnet, ${offen} offen.`);
  return { geprueft: kampagnen.length, zugeordnet, offen };
}

/**
 * Sync: alle hinterlegten Werbekonten → Kampagnen + Tages-Insights upserten.
 * backfill=true → 90 Tage (Erstlauf), sonst letzte 7 Tage. Konto für Konto (Rate-Limit).
 * Dormant ohne Token. { skipped } wenn kein Token / keine Konten.
 */
export async function syncMetaKampagnen({ backfill = false } = {}) {
  if (running) return { skipped: true, reason: 'laeuft_bereits' };
  running = true;
  const t0 = Date.now();
  try {
    const token = await getMetaToken();
    if (!token) {
      lastResult = { skipped: true, reason: 'kein_token', duration_ms: Date.now() - t0 };
      lastRunAt = new Date().toISOString();
      console.log('[meta-sync] Kein System-User-Token hinterlegt — Sync übersprungen (dormant).');
      return lastResult;
    }
    const konten = await sammleWerbekonten();
    if (!konten.length) {
      lastResult = { skipped: true, reason: 'keine_werbekonten', duration_ms: Date.now() - t0 };
      lastRunAt = new Date().toISOString();
      console.log('[meta-sync] Kein Werbekonto zugeordnet (meta_werbekonto_id) — nichts zu tun.');
      return lastResult;
    }

    const tage = backfill ? 90 : 7;
    const until = ymd(Date.now());
    const since = ymd(Date.now() - tage * 86400000);
    let kampagnenGesamt = 0, insightsGesamt = 0;
    const kontoFehler = [];

    for (const konto of konten) {
      try {
        // 1) Kampagnen
        const kampagnen = await graphAll(`${konto}/campaigns`, {
          fields: 'id,name,start_time,effective_status,daily_budget,lifetime_budget',
          limit: '200',
        }, token);
        for (const c of kampagnen) {
          // vorheriger Status merken (für den späteren Status-Wächter).
          const { data: bestehend } = await supabase.from('talentone_meta_kampagnen')
            .select('effective_status').eq('meta_campaign_id', c.id).maybeSingle();
          await supabase.from('talentone_meta_kampagnen').upsert({
            meta_campaign_id: c.id,
            werbekonto_id: konto,
            name: c.name || null,
            meta_start_time: c.start_time || null,
            effective_status: c.effective_status || null,
            daily_budget: c.daily_budget != null ? Number(c.daily_budget) : null,
            lifetime_budget: c.lifetime_budget != null ? Number(c.lifetime_budget) : null,
            vorheriger_status: bestehend?.effective_status ?? null,
            zuletzt_gesynct: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }, { onConflict: 'meta_campaign_id' });
          kampagnenGesamt++;
        }
        await sleep(400);

        // 2) Tages-Insights (Kampagnen-Level)
        const insights = await graphAll(`${konto}/insights`, {
          level: 'campaign',
          time_increment: '1',
          time_range: JSON.stringify({ since, until }),
          fields: 'campaign_id,spend,impressions,clicks,ctr,cpm,actions',
          limit: '500',
        }, token);
        for (const row of insights) {
          const datum = row.date_start;
          if (!row.campaign_id || !datum) continue;
          await supabase.from('talentone_meta_insights').upsert({
            meta_campaign_id: row.campaign_id,
            datum,
            spend: row.spend != null ? Number(row.spend) : null,
            impressions: row.impressions != null ? Number(row.impressions) : null,
            clicks: row.clicks != null ? Number(row.clicks) : null,
            ctr: row.ctr != null ? Number(row.ctr) : null,
            cpm: row.cpm != null ? Number(row.cpm) : null,
            leads: leadsAusActions(row.actions),
            results: leadsAusActions(row.actions),
            updated_at: new Date().toISOString(),
          }, { onConflict: 'meta_campaign_id,datum' });
          insightsGesamt++;
        }
        await sleep(600); // Pause zwischen Konten — Rate-Limit-schonend
      } catch (err) {
        console.warn(`[meta-sync] Konto ${konto}: ${err.message}`);
        kontoFehler.push({ konto, fehler: err.message });
      }
    }

    // Kampagnen automatisch Projekten/Kunden zuordnen (Namens-Match). Rest bleibt offen
    // und sichtbar in der „Nicht zugeordnet"-Liste.
    let match = null;
    try { match = await matchKampagnen(); } catch (e) { console.warn('[meta-sync] match:', e.message); }

    lastResult = {
      ok: true, konten: konten.length, kampagnen: kampagnenGesamt, insights: insightsGesamt,
      backfill, zeitraum: { since, until }, konto_fehler: kontoFehler, match, duration_ms: Date.now() - t0,
    };
    lastRunAt = new Date().toISOString();
    console.log(`[meta-sync] ${konten.length} Konten, ${kampagnenGesamt} Kampagnen, ${insightsGesamt} Insight-Tage — ${kontoFehler.length} Kontofehler.`);
    return lastResult;
  } finally { running = false; }
}

export function getMetaSyncStatus() {
  return { running, last_run_at: lastRunAt, last_result: lastResult };
}

/** Ist überhaupt schon einmal gesynct worden? (Für Erstlauf-Backfill-Entscheidung.) */
export async function braucheBackfill() {
  const { count } = await supabase.from('talentone_meta_insights')
    .select('meta_campaign_id', { count: 'exact', head: true });
  return (count || 0) === 0;
}

/** Scheduler: stündlich prüfen, nur 05:00 Berlin auslösen. Erstlauf → 90-Tage-Backfill. */
export function startMetaSyncScheduler() {
  const CHECK_MS = 60 * 60 * 1000;
  const INIT_MS = 340 * 1000;
  const check = async () => {
    const berlinHour = Number(new Date().toLocaleString('de-DE', { hour: '2-digit', hour12: false, timeZone: 'Europe/Berlin' }));
    if (berlinHour !== 5) return;
    if (!(await getMetaToken())) return; // dormant
    const backfill = await braucheBackfill();
    syncMetaKampagnen({ backfill }).catch(err => console.error('[meta-sync]', err.message));
  };
  setTimeout(() => { check().catch(() => {}); setInterval(() => check().catch(() => {}), CHECK_MS); }, INIT_MS);
  console.log('[meta-sync] Scheduler aktiv (täglich 05:00 Berlin, dormant ohne Token).');
}
