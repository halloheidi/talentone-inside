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
async function sammleWerbekonten() {
  const [p, j] = await Promise.all([
    supabase.from('talentone_projekte').select('meta_werbekonto_id').not('meta_werbekonto_id', 'is', null),
    supabase.from('talentone_jobs').select('meta_werbekonto_id').not('meta_werbekonto_id', 'is', null),
  ]);
  const set = new Set();
  for (const r of [...(p.data || []), ...(j.data || [])]) {
    const id = String(r.meta_werbekonto_id || '').trim();
    if (id) set.add(id.startsWith('act_') ? id : `act_${id}`);
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

    lastResult = {
      ok: true, konten: konten.length, kampagnen: kampagnenGesamt, insights: insightsGesamt,
      backfill, zeitraum: { since, until }, konto_fehler: kontoFehler, duration_ms: Date.now() - t0,
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
