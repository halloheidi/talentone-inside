// Instantly.ai (Cold-Mail) — NUR LESEN (V1 des Heute-Dashboards). Best-effort:
// wirft nie an den Aufrufer, liefert bei fehlendem Key/Fehler ein strukturiertes
// Ergebnis mit `configured:false`/`error`. API v2, Bearer-Auth.
// Key: DB-Setting instantly_api_key (sonst env INSTANTLY_API_KEY).

import { getSecret } from './settings-secrets.js';

const BASE = 'https://api.instantly.ai/api/v2';
const UNIBOX_URL = 'https://app.instantly.ai/app/unibox';

export async function getInstantlyKey() {
  return (await getSecret('instantly_api_key')) || null;
}

async function iFetch(path) {
  const key = await getInstantlyKey();
  if (!key) return { _noKey: true };
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Instantly ${path} → ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

const num = v => (typeof v === 'number' && isFinite(v) ? v : (v == null ? 0 : Number(v) || 0));
const berlinHeute = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/**
 * Überblick je aktiver Kampagne: Name, heute gesendet, Replies gesamt, Bounce-Rate
 * (>3% = Warnung), Unibox-Link. Best-effort — unbekannte API-Felder → null/0.
 * @returns {{ configured:boolean, error?:string, unibox_url:string, kampagnen:Array }}
 */
export async function getInstantlyOverview() {
  const key = await getInstantlyKey();
  if (!key) return { configured: false, unibox_url: UNIBOX_URL, kampagnen: [] };
  try {
    // 1) Kampagnen holen (v2 paginiert via starting_after; wir nehmen die erste Seite).
    const camp = await iFetch('/campaigns?limit=100');
    const items = Array.isArray(camp?.items) ? camp.items : (Array.isArray(camp) ? camp : []);
    // status 1 = Active (Instantly). Fallback: wenn keine als aktiv markiert, alle zeigen.
    const aktive = items.filter(c => c.status === 1);
    const liste = (aktive.length ? aktive : items).slice(0, 20);

    // 2) Analytics-Overview (Replies/Bounce/Sent gesamt) — ein Call für alle.
    let analyticsMap = {};
    try {
      const an = await iFetch('/campaigns/analytics');
      const arr = Array.isArray(an) ? an : (Array.isArray(an?.items) ? an.items : []);
      for (const a of arr) {
        const id = a.campaign_id || a.id;
        if (id) analyticsMap[id] = a;
      }
    } catch (e) { console.warn('[instantly] analytics:', e.message); }

    // 3) „Heute gesendet" je Kampagne über die Tages-Analytics (best-effort, gedeckelt).
    const heute = berlinHeute();
    const kampagnen = [];
    for (const c of liste) {
      const a = analyticsMap[c.id] || {};
      const sent = num(a.emails_sent_count ?? a.sent_count ?? a.sent);
      const bounced = num(a.bounced_count ?? a.bounces);
      const bounceRate = sent > 0 ? Math.round((bounced / sent) * 1000) / 10 : 0;
      let sentToday = null;
      try {
        const daily = await iFetch(`/campaigns/analytics/daily?campaign_id=${encodeURIComponent(c.id)}&start_date=${heute}&end_date=${heute}`);
        const rows = Array.isArray(daily) ? daily : (Array.isArray(daily?.items) ? daily.items : []);
        sentToday = rows.reduce((s, r) => s + num(r.sent ?? r.emails_sent_count ?? r.sent_count), 0);
      } catch (e) { /* daily evtl. nicht verfügbar → null */ }
      kampagnen.push({
        id: c.id,
        name: c.name || '(ohne Name)',
        sent_today: sentToday,
        replies_total: num(a.reply_count ?? a.replies ?? a.total_replies),
        bounce_rate: bounceRate,
        bounce_warn: bounceRate > 3,
        unibox_url: UNIBOX_URL,
      });
    }
    return { configured: true, unibox_url: UNIBOX_URL, kampagnen };
  } catch (err) {
    console.warn('[instantly] overview:', err.message);
    return { configured: true, error: err.message, unibox_url: UNIBOX_URL, kampagnen: [] };
  }
}
