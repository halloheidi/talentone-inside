// Cron für eigene Meta-Lead-Ads: pollt die konfigurierten Sheets alle 12 Minuten
// und versucht offene Close-Syncs erneut. No-Op ohne konfigurierte Quellen.

import { pollAllQuellen } from './eigene-leads-service.js';

export function startEigeneLeadsScheduler() {
  const INTERVAL_MS = 12 * 60 * 1000;
  const INITIAL_DELAY_MS = 120 * 1000;
  const run = () => pollAllQuellen().catch(err => console.error('[eigene-leads] cron:', err.message));
  setTimeout(() => { run(); setInterval(run, INTERVAL_MS); }, INITIAL_DELAY_MS);
  console.log('[eigene-leads] Scheduler aktiv (initial +120s, danach alle 12 Min).');
}
