// Bulk-Sync der easybill-Kundenliste in den lokalen Cache
// (talentone_easybill_customers). Wird per Cron stündlich und on-demand
// über POST /api/easybill-customers/sync ausgelöst.

import { supabase } from './supabase.js';
import { listCustomers } from './easybill.js';

const PAGE_SIZE = 1000; // easybill-Maximum

let running = false;      // reentrancy-Schutz (Cron + on-demand)
let lastRunAt = null;
let lastResult = null;    // { upserted, pages, total, duration_ms, error? }

/**
 * Normalisiert ein easybill-Customer-Objekt in ein Cache-Row.
 * emails → array; email = emails[0] als Convenience.
 */
export function mapCustomerToRow(c) {
  const emails = Array.isArray(c?.emails) ? c.emails.filter(Boolean) : [];
  return {
    easybill_id:         Number(c.id),
    number:              c.number || null,
    company_name:        c.company_name || null,
    first_name:          c.first_name || null,
    last_name:           c.last_name || null,
    email:               emails[0] || null,
    emails,
    street:              c.street || null,
    zip_code:            c.zip_code || null,
    city:                c.city || null,
    country:             c.country || null,
    phone_1:             c.phone_1 || null,
    phone_2:             c.phone_2 || null,
    vat_identifier:      c.vat_identifier || null,
    raw:                 c,
    easybill_created_at: c.created_at || null,
    easybill_updated_at: c.updated_at || null,
    synced_at:           new Date().toISOString(),
  };
}

/**
 * Vollständiger Sync aller Kunden aus easybill in den Cache.
 * Läuft paginiert (1000er-Chunks), upsert per easybill_id.
 */
export async function syncAllCustomers() {
  if (running) {
    return { skipped: true, reason: 'Sync läuft bereits.' };
  }
  running = true;
  const t0 = Date.now();
  let upserted = 0;
  let pagesFetched = 0;
  let total = 0;
  try {
    let page = 1;
    let pages = 1;
    while (page <= pages) {
      const res = await listCustomers({ page, limit: PAGE_SIZE });
      pages = Math.max(res.pages || 1, 1);
      total = res.total || total;
      pagesFetched++;

      if (res.items.length) {
        const rows = res.items.map(mapCustomerToRow);
        const { error } = await supabase
          .from('talentone_easybill_customers')
          .upsert(rows, { onConflict: 'easybill_id' });
        if (error) throw new Error(`Supabase upsert: ${error.message}`);
        upserted += rows.length;
      }
      page++;
    }
    lastResult = { upserted, pages: pagesFetched, total, duration_ms: Date.now() - t0 };
    lastRunAt = new Date().toISOString();
    console.log(`[easybill-sync] Fertig — ${upserted} Kunden aus ${pagesFetched} Seite(n) (${lastResult.duration_ms} ms)`);
    return lastResult;
  } catch (err) {
    lastResult = { upserted, pages: pagesFetched, total, duration_ms: Date.now() - t0, error: err.message };
    lastRunAt = new Date().toISOString();
    console.error(`[easybill-sync] Fehler nach ${upserted} Kunden:`, err.message);
    throw err;
  } finally {
    running = false;
  }
}

/**
 * Upsert eines einzelnen Customer-Objekts (nach POST/PUT gegen easybill,
 * damit der Cache sofort aktuell ist ohne komplette Runde).
 */
export async function upsertCustomerInCache(easybillCustomer) {
  if (!easybillCustomer?.id) return null;
  const row = mapCustomerToRow(easybillCustomer);
  const { data, error } = await supabase
    .from('talentone_easybill_customers')
    .upsert(row, { onConflict: 'easybill_id' })
    .select().single();
  if (error) throw new Error(`Cache-Upsert: ${error.message}`);
  return data;
}

export function getSyncStatus() {
  return { running, last_run_at: lastRunAt, last_result: lastResult };
}

/**
 * Startet den stündlichen Cron-Scheduler.
 * - Initial-Run nach 30 s (damit der Server erst hochkommt).
 * - Danach alle 60 min. Fehler werden geloggt, blockieren nichts.
 */
export function startEasybillCustomerSyncScheduler() {
  const INTERVAL_MS = 60 * 60 * 1000;
  const INITIAL_DELAY_MS = 30 * 1000;

  if (!process.env.EASYBILL_API_KEY) {
    console.warn('[easybill-sync] EASYBILL_API_KEY nicht gesetzt — Scheduler nicht gestartet.');
    return;
  }

  setTimeout(() => {
    syncAllCustomers().catch(err => console.error('[easybill-sync] initial:', err.message));
    setInterval(() => {
      syncAllCustomers().catch(err => console.error('[easybill-sync] cron:', err.message));
    }, INTERVAL_MS);
  }, INITIAL_DELAY_MS);

  console.log('[easybill-sync] Scheduler aktiv (initial +30s, danach stündlich).');
}
