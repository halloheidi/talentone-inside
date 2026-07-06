// Monatlicher Rechnungslauf-Scheduler (Phase 5 Nachtrag).
//
// Läuft täglich um 06:00 (Berlin). An einem konfigurierbaren Stichtag
// (Default 25. des Vormonats für den Folgemonat — damit Prepaid vor
// Monatsbeginn bezahlt sein kann) triggert er den monatlichen Lauf für
// ALLE aktiven Abos (campaign_started_at != null, billing_ended_at == null,
// billing_paused_at == null oder manuell reaktiviert).
//
// Für jedes Angebot wendet runMonthlyBillingForOffer() die Regel aus
// billing-rules.js an, erzeugt (oder überspringt) die Rechnung und schreibt
// bei Bedarf den Skip-Log.

import { supabase } from './supabase.js';
import { runMonthlyBillingForOffer } from './invoice-service.js';

const BILLING_TRIGGER_DAY = Number(process.env.BILLING_TRIGGER_DAY || 25);

let running = false;
let lastRunAt = null;
let lastResult = null;

/**
 * @param {Date} today
 * @returns {string|null} YYYY-MM-DD des Folgemonat-Ersten wenn today.day == trigger, sonst null.
 */
export function periodForRun(today, triggerDay = BILLING_TRIGGER_DAY) {
  const day = today.getDate();
  if (day !== triggerDay) return null;
  const next = new Date(today);
  next.setMonth(next.getMonth() + 1);
  next.setDate(1);
  return next.toISOString().slice(0, 10);
}

export async function runMonthlyBillingRound({ today = new Date(), triggerDay } = {}) {
  if (running) return { skipped: true, reason: 'running' };
  const periodStart = periodForRun(today, triggerDay);
  if (!periodStart) return { skipped: true, reason: 'not_trigger_day', today: today.toISOString().slice(0, 10) };

  running = true;
  const t0 = Date.now();
  const stats = { processed: 0, bill_full: 0, bill_budget_only: 0,
                  skip_and_wait_first_hire: 0, skip_manual_reactivation: 0,
                  skip_service_waived: 0, skip_billing_paused: 0,
                  skip_campaign_ended: 0, already_billed: 0, already_logged: 0,
                  errors: [] };
  try {
    const { data: offers, error } = await supabase
      .from('talentone_offers')
      .select('id, brand, billing_paused_at, billing_ended_at')
      .not('campaign_started_at', 'is', null)
      .is('billing_ended_at', null);
    if (error) throw new Error(error.message);
    for (const o of offers || []) {
      stats.processed++;
      try {
        const r = await runMonthlyBillingForOffer(o.id, { today, periodStart });
        stats[r.action] = (stats[r.action] || 0) + 1;
      } catch (err) {
        stats.errors.push({ offer_id: o.id, error: err.message });
        console.error(`[billing-cron] Fehler bei ${o.id}: ${err.message}`);
      }
    }
    lastResult = { periodStart, ...stats, duration_ms: Date.now() - t0 };
    lastRunAt = new Date().toISOString();
    console.log(`[billing-cron] Lauf fertig — Periode ${periodStart}:`, JSON.stringify(stats));
    return lastResult;
  } finally { running = false; }
}

export function getBillingCronStatus() {
  return { running, last_run_at: lastRunAt, last_result: lastResult };
}

/**
 * Startet den täglich-06:00-Berlin-Check. An Trigger-Tagen wird
 * runMonthlyBillingRound() aufgerufen — an allen anderen Tagen no-op.
 * Der Berlin-06:00-Cron wird über die Zeitzonen-Differenz zu UTC abgebildet
 * (setInterval mit 1h-Tick, prüft in jedem Tick ob es "06:00 Europe/Berlin"
 * ist).
 */
export function startBillingScheduler() {
  const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1h
  const INITIAL_DELAY_MS = 120 * 1000;      // 2 min nach Start

  if (!process.env.EASYBILL_API_KEY) {
    console.warn('[billing-cron] EASYBILL_API_KEY nicht gesetzt — Scheduler nicht gestartet.');
    return;
  }
  const check = () => {
    const now = new Date();
    // "Berlin 06:00" — best-effort ohne extra Tz-Bibliothek.
    // Berlin ist UTC+1/2. Wir triggern zwischen 5–6 UTC (das trifft den Bereich).
    const berlinHour = Number(now.toLocaleString('de-DE', { hour: '2-digit', hour12: false, timeZone: 'Europe/Berlin' }));
    if (berlinHour !== 6) return;
    runMonthlyBillingRound({ today: now })
      .catch(err => console.error('[billing-cron]', err.message));
  };
  setTimeout(() => {
    check();
    setInterval(check, CHECK_INTERVAL_MS);
  }, INITIAL_DELAY_MS);
  console.log(`[billing-cron] Scheduler aktiv (Trigger-Tag ${BILLING_TRIGGER_DAY}. jeden Monats, 06:00 Berlin).`);
}
