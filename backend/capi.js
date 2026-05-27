// Meta Conversions API — serverseitige Event-Übermittlung.
// Best-effort: Fehler werden nur geloggt.

import crypto from 'node:crypto';

const GRAPH_API = process.env.META_CAPI_BASE || 'https://graph.facebook.com/v21.0';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '').trim().toLowerCase()).digest('hex');
}

// Standard-Eventnamen die Meta direkt versteht
const STANDARD_EVENTS = new Set(['Lead', 'CompleteRegistration', 'SubmitApplication', 'Purchase', 'Contact']);

/**
 * Sendet ein einzelnes Conversion-Event ans Meta Pixel.
 * Best-effort: returnt boolean (success/fail), loggt aber nichts ans Frontend.
 *
 * @param {object} opts
 * @param {string} opts.pixelId
 * @param {string} opts.accessToken
 * @param {string} opts.eventName       z.B. 'Lead' oder Custom
 * @param {string} [opts.eventSourceUrl]
 * @param {object} [opts.userData]      { email, phone, clientIp, userAgent, fbp, fbc }
 * @param {object} [opts.customData]    z.B. { value, currency, content_name }
 */
export async function sendCapiEvent({ pixelId, accessToken, eventName, eventSourceUrl, userData = {}, customData }) {
  if (!pixelId || !accessToken || !eventName) return false;

  const ud = {};
  if (userData.email)     ud.em = [sha256(userData.email)];
  if (userData.phone)     ud.ph = [sha256(userData.phone.replace(/[^\d+]/g, ''))];
  if (userData.clientIp)  ud.client_ip_address = userData.clientIp;
  if (userData.userAgent) ud.client_user_agent = userData.userAgent;
  if (userData.fbp)       ud.fbp = userData.fbp;
  if (userData.fbc)       ud.fbc = userData.fbc;

  const isStandard = STANDARD_EVENTS.has(eventName);
  const evt = {
    event_name: isStandard ? eventName : 'Lead', // Custom-Events brauchen einen Standard als Fallback
    event_time: Math.floor(Date.now() / 1000),
    action_source: 'website',
    user_data: ud,
  };
  if (eventSourceUrl) evt.event_source_url = eventSourceUrl;
  if (customData) evt.custom_data = customData;
  if (!isStandard) {
    evt.custom_data = { ...(evt.custom_data || {}), original_event_name: eventName };
  }

  try {
    const url = `${GRAPH_API}/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(accessToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [evt] }),
    });
    const body = await res.text();
    if (!res.ok) {
      console.warn(`[CAPI] ${res.status}: ${body.slice(0, 300)}`);
      return false;
    }
    console.log(`[CAPI] event ${eventName} → pixel ${pixelId.slice(0, 6)} ok`);
    return true;
  } catch (err) {
    console.warn('[CAPI] Fehler:', err.message);
    return false;
  }
}
