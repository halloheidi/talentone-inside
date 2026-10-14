// Gmail-Anbindung (Heute-Dashboard, Phase 2) — Mehrkonten-OAuth + Lesen + Antworten.
// Ohne googleapis-Dependency: reine REST-Calls per fetch (wie google-sheets.js).
// Per-NUTZER-OAuth (nicht Service-Account!). NIEMALS automatischer Versand — nur
// auf expliziten Klick aus dem Dashboard; jeder Versand wird protokolliert.

import { randomUUID } from 'node:crypto';
import { supabase } from './supabase.js';
import { getSecret } from './settings-secrets.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

// gmail.send + gmail.compose + gmail.readonly sind „restricted scopes" (Google-
// Verifizierung bzw. interne Workspace-App / Test-Nutzer nötig). openid+email für Identität.
export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/calendar.events', // RSVP auf Termineinladungen
  'openid', 'email',
].join(' ');

export async function getOAuthConfig() {
  const clientId = await getSecret('google_oauth_client_id');
  const clientSecret = await getSecret('google_oauth_client_secret');
  const redirect = (await getSecret('google_oauth_redirect')) || 'https://inside.talent-one.de/api/gmail/oauth/callback';
  return { clientId, clientSecret, redirect, configured: !!(clientId && clientSecret) };
}

export async function buildAuthUrl(state) {
  const { clientId, redirect } = await getOAuthConfig();
  const p = new URLSearchParams({
    client_id: clientId || '', redirect_uri: redirect, response_type: 'code',
    scope: GMAIL_SCOPES, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  });
  return `${AUTH_URL}?${p.toString()}`;
}

export async function exchangeCode(code) {
  const { clientId, clientSecret, redirect } = await getOAuthConfig();
  const res = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirect, grant_type: 'authorization_code' }),
  });
  if (!res.ok) throw new Error(`Token-Exchange ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const tok = await res.json(); // { access_token, refresh_token, expires_in, scope, id_token }
  // Konto-Identität: Gmail-Profil (emailAddress) — braucht nur das gmail-Scope.
  const prof = await fetch(`${GMAIL}/profile`, { headers: { Authorization: `Bearer ${tok.access_token}` } });
  const email = prof.ok ? (await prof.json()).emailAddress : null;
  return { tok, email };
}

export async function saveKonto({ email, tokens, connectedBy }) {
  if (!email) throw new Error('Keine E-Mail-Adresse vom Google-Konto erhalten.');
  const expiry = new Date(Date.now() + (tokens.expires_in || 3500) * 1000).toISOString();
  // refresh_token kommt nur beim ersten consent — bei Re-Auth ggf. leer: dann bestehenden behalten.
  const patch = {
    email, access_token: tokens.access_token, token_expiry: expiry,
    scope: tokens.scope || GMAIL_SCOPES, status: 'aktiv', connected_by: connectedBy,
    updated_at: new Date().toISOString(),
  };
  if (tokens.refresh_token) patch.refresh_token = tokens.refresh_token;
  const { error } = await supabase.from('talentone_gmail_konten').upsert(patch, { onConflict: 'email' });
  if (error) throw new Error(error.message);
}

export async function listKonten() {
  const { data } = await supabase.from('talentone_gmail_konten')
    .select('id, email, display_name, status, scope, connected_by, connected_at')
    .order('connected_at', { ascending: true });
  return data || [];
}
export async function deleteKonto(id) {
  await supabase.from('talentone_gmail_konten').delete().eq('id', id);
}
async function ladeKontoRow(idOrEmail) {
  const col = String(idOrEmail).includes('@') ? 'email' : 'id';
  const { data } = await supabase.from('talentone_gmail_konten').select('*').eq(col, idOrEmail).maybeSingle();
  return data;
}

// Access-Token holen (bei Ablauf via refresh_token erneuern + persistieren).
async function getAccessToken(konto) {
  if (konto.access_token && konto.token_expiry && new Date(konto.token_expiry).getTime() - 60000 > Date.now()) {
    return konto.access_token;
  }
  if (!konto.refresh_token) throw new Error('Kein refresh_token — Konto neu verbinden.');
  const { clientId, clientSecret } = await getOAuthConfig();
  const res = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: konto.refresh_token, grant_type: 'refresh_token' }),
  });
  if (!res.ok) {
    await supabase.from('talentone_gmail_konten').update({ status: 'fehler' }).eq('id', konto.id);
    throw new Error(`Token-Refresh ${res.status}`);
  }
  const tok = await res.json();
  const expiry = new Date(Date.now() + (tok.expires_in || 3500) * 1000).toISOString();
  await supabase.from('talentone_gmail_konten').update({ access_token: tok.access_token, token_expiry: expiry, status: 'aktiv' }).eq('id', konto.id);
  return tok.access_token;
}

async function gmailFetch(konto, path, opts = {}) {
  const token = await getAccessToken(konto);
  const res = await fetch(`${GMAIL}${path}`, { ...opts, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  if (!res.ok) throw new Error(`Gmail ${opts.method || 'GET'} ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  if (res.status === 204) return {};
  const txt = await res.text();
  return txt ? JSON.parse(txt) : {};
}

const hdr = (headers, name) => (headers || []).find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
const emailAus = (from) => { const m = String(from).match(/<([^>]+)>/); return (m ? m[1] : String(from)).trim().toLowerCase(); };

// Header, die für die Relevanz-Klassifizierung gebraucht werden.
const KLASS_HEADERS = ['From', 'Subject', 'Date', 'To', 'List-Unsubscribe', 'List-Id', 'Precedence', 'Auto-Submitted', 'Reply-To'];

// Rekursiv prüfen, ob die MIME-Struktur einen Kalender-Anhang enthält (text/calendar
// oder .ics) — verfügbar auch in format=metadata (Part-Struktur ohne Body).
function hatKalenderPart(payload) {
  if (!payload) return false;
  const mt = (payload.mimeType || '').toLowerCase();
  const fn = (payload.filename || '').toLowerCase();
  if (mt === 'text/calendar' || mt === 'application/ics' || fn.endsWith('.ics')) return true;
  return (payload.parts || []).some(hatKalenderPart);
}
const EINLADUNG_RE = /^\s*(einladung|invitation|updated invitation|aktualisierte einladung|canceled event|abgesagt)\s*:/i;
const KALENDER_ABSENDER_RE = /(calendar-notification@google\.com|@calendar\.google\.com|@resource\.calendar\.google\.com)/i;

/** INBOX-Mails eines Kontos (Metadaten inkl. Klassifizierungs-Header + labelIds). */
export async function listWichtigeMails(konto, { max = 40, query = 'is:unread in:inbox' } = {}) {
  const list = await gmailFetch(konto, `/messages?q=${encodeURIComponent(query)}&maxResults=${max}`);
  const ids = (list.messages || []).map(m => m.id);
  const out = [];
  const hq = KLASS_HEADERS.map(h => `metadataHeaders=${encodeURIComponent(h)}`).join('&');
  for (const id of ids) {
    try {
      const msg = await gmailFetch(konto, `/messages/${id}?format=metadata&${hq}`);
      const hdrs = msg.payload?.headers || [];
      const map = {}; for (const x of hdrs) map[x.name.toLowerCase()] = x.value;
      const from = hdr(hdrs, 'From');
      const dateStr = hdr(hdrs, 'Date');
      const ts = dateStr ? Date.parse(dateStr) : Date.now();
      out.push({
        konto_email: konto.email, id, threadId: msg.threadId,
        from, fromEmail: emailAus(from), subject: hdr(hdrs, 'Subject') || '(kein Betreff)',
        date: dateStr, ageTage: Math.max(0, Math.floor((Date.now() - ts) / 86400000)),
        important: (msg.labelIds || []).includes('IMPORTANT'),
        labelIds: msg.labelIds || [], headers: map, snippet: msg.snippet || '',
        ungelesen: (msg.labelIds || []).includes('UNREAD'),
        terminKandidat: hatKalenderPart(msg.payload) || EINLADUNG_RE.test(hdr(hdrs, 'Subject') || '') || KALENDER_ABSENDER_RE.test(from),
        link: `https://mail.google.com/mail/u/0/#inbox/${msg.threadId}`,
      });
    } catch (e) { /* einzelne Mail-Fehler überspringen */ }
  }
  return out;
}

const SYSTEM_DOMAINS = ['inside.talent-one.de'];
const PLATTFORM_DOMAINS = ['linkedin.com', 'facebookmail.com', 'facebook.com', 'meta.com', 'mail.instagram.com',
  'google.com', 'accounts.google.com', 'googlemail.com', 'instantly.ai', 'mailchimp.com', 'sendgrid.net',
  'substack.com', 'youtube.com', 'xing.com', 'indeed.com', 'stepstone.de'];
const LOCAL_MUSTER = /^(no-?reply|do-?not-?reply|donotreply|newsletter|notifications?|mailer-daemon|bounce|postmaster|automailer|mailer|news)$/i;

/**
 * Verteiler-/Automatik-Erkennung (ausfiltern). @returns { bulk, grund|null }
 * Header-Signale > Gmail-Kategorie > Absender-Muster/Plattform > eigene System-Mails.
 */
export function istVerteiler({ fromEmail = '', headers = {}, labelIds = [] } = {}) {
  const h = headers || {};
  if (h['list-unsubscribe']) return { bulk: true, grund: 'List-Unsubscribe' };
  if (/\b(bulk|list|junk)\b/i.test(h['precedence'] || '')) return { bulk: true, grund: 'Precedence' };
  if (h['list-id']) return { bulk: true, grund: 'List-Id' };
  const as = (h['auto-submitted'] || '').toLowerCase();
  if (as && as !== 'no') return { bulk: true, grund: 'Auto-Submitted' };
  const cat = (labelIds || []).find(l => ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS'].includes(l));
  if (cat) return { bulk: true, grund: 'Gmail-Kategorie ' + cat.replace('CATEGORY_', '') };
  const local = (fromEmail.split('@')[0] || '').toLowerCase();
  const domain = (fromEmail.split('@')[1] || '').toLowerCase();
  if (LOCAL_MUSTER.test(local) || /(no-?reply|newsletter|notification)/i.test(local)) return { bulk: true, grund: 'Absender-Muster' };
  if (SYSTEM_DOMAINS.includes(domain)) return { bulk: true, grund: 'eigene System-Mail' };
  if (PLATTFORM_DOMAINS.some(p => domain === p || domain.endsWith('.' + p))) return { bulk: true, grund: `Plattform (${domain})` };
  return { bulk: false, grund: null };
}

// Beleg-/Transaktions-Betreffe (Zahlungen, Rechnungen, Bestellungen, Abos …).
const BELEG_SUBJECT_RE = /(zahlung|zahlungsbest|zahlungseingang|abbuchung|lastschrift|ihre rechnung|rechnung\s*nr|bestellbest|ihre bestellung|buchungsbest|kontoauszug|gutschrift|mahnung|receipt|payment|invoice|order confirmation|subscription renewed)/i;
// Distinktive Zahlungs-/Abo-/Provider-/Bank-Domains (Wortgrenzen, damit kein false-positive).
const BELEG_DOMAIN_RE = /(^|\.)(paypal|stripe|klarna|mollie|gocardless|sumup|amazon|apple|easybill|lexoffice|sevdesk|sparkasse|volksbank|commerzbank|n26|qonto|hetzner|ionos|strato|telekom|vodafone)(\.|$)/i;
const BELEG_LOCALS = new Set(['payment', 'payments', 'billing', 'rechnung', 'rechnungen', 'invoice', 'invoicing', 'buchhaltung']);

/**
 * Beleg-/Transaktions-Erkennung. Greift NUR, wenn kein CRM-Match vorliegt (der
 * Aufrufer ruft dies erst nach dem CRM-Check). @returns { bulk, grund }
 */
export function istBeleg({ fromEmail = '', subject = '', headers = {}, snippet = '' } = {}) {
  const grund = 'Beleg/Transaktion';
  const local = (fromEmail.split('@')[0] || '').toLowerCase();
  const domain = (fromEmail.split('@')[1] || '').toLowerCase();
  const subjHit = BELEG_SUBJECT_RE.test(subject || '');
  if (BELEG_DOMAIN_RE.test(domain)) return { bulk: true, grund };
  if (BELEG_LOCALS.has(local)) return { bulk: true, grund };
  if (local === 'service' && subjHit) return { bulk: true, grund };
  if (subjHit) return { bulk: true, grund };
  // Zusatzsignal: (fehlendes/noreply-Reply-To) UND Geldbetrag/Währung im Snippet.
  const replyTo = (headers['reply-to'] || '').toLowerCase();
  const noReply = !replyTo || /no-?reply|do-?not-?reply|donotreply/.test(replyTo);
  const geld = /(€|\beur\b|\$|\bchf\b|\bgbp\b)/i.test(snippet) || /\d+[.,]\d{2}\s?(€|eur)/i.test(snippet);
  if (noReply && geld) return { bulk: true, grund };
  return { bulk: false, grund: null };
}

// Maschineller Absender (Rollen-Local ODER Plattform-/System-Domain) — solche Mails
// sind NIE „individuell" und dürfen von der Grundregel nicht geschützt werden.
export function maschinellerAbsender(fromEmail = '') {
  const local = (fromEmail.split('@')[0] || '').toLowerCase();
  const domain = (fromEmail.split('@')[1] || '').toLowerCase();
  if (LOCAL_MUSTER.test(local) || /(no-?reply|newsletter|notification)/i.test(local)) return true;
  if (SYSTEM_DOMAINS.includes(domain)) return true;
  if (PLATTFORM_DOMAINS.some(p => domain === p || domain.endsWith('.' + p))) return true;
  return false;
}

// Letzte Nachricht im Thread von mir? → beantwortet (dann aus der Kachel raus).
export async function threadUnbeantwortet(konto, threadId) {
  try {
    const t = await gmailFetch(konto, `/threads/${threadId}?format=metadata&metadataHeaders=From`);
    // ENTWÜRFE zählen NICHT als Antwort (threads.get liefert Drafts als Nachrichten mit).
    const msgs = (t.messages || []).filter(m => !(m.labelIds || []).includes('DRAFT'));
    if (!msgs.length) return true;
    const last = msgs[msgs.length - 1];
    const from = emailAus(hdr(last.payload?.headers || [], 'From'));
    return from !== (konto.email || '').toLowerCase();
  } catch { return true; } // im Zweifel anzeigen
}

const ruleMatches = (muster, fromEmail) => {
  const m = (muster || '').trim().toLowerCase(); const e = (fromEmail || '').toLowerCase();
  if (!m || !e) return false;
  if (m.includes('@')) return m === e;
  return e.endsWith('@' + m) || e.split('@')[1] === m;
};
export { ruleMatches };

/** Eine Mail im Volltext (für KI-Vorschlag + korrekte Thread-Header). */
export async function getMessageFull(konto, id) {
  const msg = await gmailFetch(konto, `/messages/${id}?format=full`);
  const h = msg.payload?.headers || [];
  const body = extractPlainBody(msg.payload);
  return {
    id, threadId: msg.threadId,
    from: hdr(h, 'From'), fromEmail: emailAus(hdr(h, 'From')),
    subject: hdr(h, 'Subject'),
    messageIdHeader: hdr(h, 'Message-ID') || hdr(h, 'Message-Id'),
    references: hdr(h, 'References'),
    bodyText: (body || '').slice(0, 6000),
  };
}

function extractPlainBody(payload) {
  if (!payload) return '';
  const decode = (d) => d ? Buffer.from(d.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8') : '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) return decode(payload.body.data);
  for (const part of payload.parts || []) {
    if (part.mimeType === 'text/plain' && part.body?.data) return decode(part.body.data);
  }
  // Fallback: erstes text/* oder html grob entschärft
  for (const part of payload.parts || []) {
    const nested = extractPlainBody(part);
    if (nested) return nested;
  }
  if (payload.body?.data) return decode(payload.body.data).replace(/<[^>]+>/g, ' ');
  return '';
}

const b64url = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function buildRaw({ fromEmail, toEmail, subject, bodyText, inReplyTo, references }) {
  const betreff = /^re:/i.test(subject || '') ? subject : `Re: ${subject || ''}`;
  const lines = [
    `From: ${fromEmail}`,
    `To: ${toEmail}`,
    `Subject: ${betreff}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
  ];
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (inReplyTo || references) lines.push(`References: ${[references, inReplyTo].filter(Boolean).join(' ')}`);
  return b64url(`${lines.join('\r\n')}\r\n\r\n${bodyText}`);
}

/** Antwort im richtigen Thread senden. @returns { id, threadId } */
export async function sendReply(konto, { threadId, toEmail, subject, bodyText, inReplyTo, references }) {
  const raw = buildRaw({ fromEmail: konto.email, toEmail, subject, bodyText, inReplyTo, references });
  return gmailFetch(konto, '/messages/send', { method: 'POST', body: JSON.stringify({ raw, threadId }) });
}

/** Antwort als Gmail-Entwurf im Thread ablegen (nicht senden). @returns draft */
export async function createDraftReply(konto, { threadId, toEmail, subject, bodyText, inReplyTo, references }) {
  const raw = buildRaw({ fromEmail: konto.email, toEmail, subject, bodyText, inReplyTo, references });
  return gmailFetch(konto, '/drafts', { method: 'POST', body: JSON.stringify({ message: { raw, threadId } }) });
}

/* ═══════════════════ Termineinladungen (iCal) + Calendar-RSVP ═══════════════════ */
const CAL = 'https://www.googleapis.com/calendar/v3';
const b64dec = (d) => d ? Buffer.from(d.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8') : '';

function findCalendarPart(payload) {
  if (!payload) return null;
  const mt = (payload.mimeType || '').toLowerCase();
  if ((mt === 'text/calendar' || mt === 'application/ics' || (payload.filename || '').toLowerCase().endsWith('.ics')) && payload.body) return payload;
  for (const p of payload.parts || []) { const f = findCalendarPart(p); if (f) return f; }
  return null;
}

function formatICalDate(raw, params) {
  if (!raw) return null;
  try {
    if (/VALUE=DATE/i.test(params || '') || /^\d{8}$/.test(raw)) {
      const d = new Date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T00:00:00`);
      return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
    }
    const m = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
    if (!m) return raw;
    const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ? 'Z' : ''}`;
    const d = new Date(iso);
    return d.toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
  } catch { return raw; }
}

/** Lädt die .ics einer Mail und extrahiert Termin-Eckdaten. @returns null | {iCalUID,titel,start,organizer,method} */
export async function getCalendarInvite(konto, messageId) {
  const msg = await gmailFetch(konto, `/messages/${messageId}?format=full`);
  const part = findCalendarPart(msg.payload);
  if (!part) return null;
  let raw = part.body?.data;
  if (!raw && part.body?.attachmentId) {
    // Große .ics liegen als Attachment (nur per attachmentId abrufbar), nicht inline.
    try { raw = (await gmailFetch(konto, `/messages/${messageId}/attachments/${part.body.attachmentId}`)).data; } catch { /* ignore */ }
  }
  if (!raw) return null;
  const text = b64dec(raw);
  // Zeilen entfalten (Fortsetzungszeilen beginnen mit Space/Tab).
  const lines = text.replace(/\r\n[ \t]/g, '').split(/\r?\n/);
  let method = null, inEvent = false, uid = null, summary = null, dtRaw = null, dtParams = '', organizer = null;
  for (const line of lines) {
    const ci = line.indexOf(':'); if (ci < 0) continue;
    const left = line.slice(0, ci); const val = line.slice(ci + 1);
    const name = left.split(';')[0].toUpperCase();
    if (name === 'METHOD') method = val.trim().toUpperCase();
    else if (name === 'BEGIN' && val.trim().toUpperCase() === 'VEVENT') inEvent = true;
    else if (inEvent && name === 'UID' && !uid) uid = val.trim();
    else if (inEvent && name === 'SUMMARY' && !summary) summary = val.replace(/\\,/g, ',').replace(/\\n/gi, ' ').trim();
    else if (inEvent && name === 'DTSTART' && !dtRaw) { dtRaw = val.trim(); dtParams = left; }
    else if (inEvent && name === 'ORGANIZER' && !organizer) {
      const cn = left.match(/CN=([^;:]+)/i); organizer = cn ? cn[1].replace(/"/g, '') : (val.match(/mailto:(.+)/i)?.[1] || null);
    }
  }
  return { iCalUID: uid, titel: summary || '(Termin)', start: formatICalDate(dtRaw, dtParams), organizer, method };
}

async function calFetch(konto, path, opts = {}) {
  const token = await getAccessToken(konto);
  const res = await fetch(`${CAL}${path}`, { ...opts, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  if (!res.ok) { const b = await res.text(); const e = new Error(`Calendar ${opts.method || 'GET'} ${path} → ${res.status}: ${b.slice(0, 200)}`); e.status = res.status; throw e; }
  return res.json();
}

/** Setzt den eigenen responseStatus (accepted|tentative|declined) für den Termin mit iCalUID. */
export async function respondToEvent(konto, { iCalUID, responseStatus }) {
  if (!iCalUID) throw new Error('Keine iCalUID — Termin nicht eindeutig.');
  const found = await calFetch(konto, `/calendars/primary/events?iCalUID=${encodeURIComponent(iCalUID)}&maxResults=1`);
  const ev = (found.items || [])[0];
  if (!ev) throw new Error('Termin nicht im Kalender des Kontos gefunden.');
  const attendees = Array.isArray(ev.attendees) ? ev.attendees : [];
  let self = attendees.find(a => a.self) || attendees.find(a => (a.email || '').toLowerCase() === konto.email.toLowerCase());
  if (!self) { self = { email: konto.email, self: true }; attendees.push(self); }
  self.responseStatus = responseStatus;
  await calFetch(konto, `/calendars/primary/events/${encodeURIComponent(ev.id)}?sendUpdates=none`, { method: 'PATCH', body: JSON.stringify({ attendees }) });
  return { ok: true, eventId: ev.id, responseStatus };
}

/* ═══════════════════ Lese-Ansicht: Volltext, Sanitizing, Anhänge, Thread ═══════════════════ */
function extractParts(payload, acc) {
  if (!payload) return acc;
  const mt = (payload.mimeType || '').toLowerCase();
  const fn = payload.filename || '';
  if (fn && payload.body?.attachmentId) {
    acc.anhaenge.push({ filename: fn, mimeType: mt, size: payload.body.size || 0, attachmentId: payload.body.attachmentId });
  } else if (mt === 'text/html' && payload.body?.data && !acc.html) {
    acc.html = b64dec(payload.body.data);
  } else if (mt === 'text/plain' && payload.body?.data && !acc.text) {
    acc.text = b64dec(payload.body.data);
  }
  for (const p of payload.parts || []) extractParts(p, acc);
  return acc;
}

/**
 * Konservatives HTML-Sanitizing (ohne Dependency): entfernt Scripts/Styles/iframes/
 * Event-Handler/javascript:-URLs; externe Bilder werden standardmäßig geblockt
 * (src → data-blocked-src). Wird zusätzlich im Frontend in einem sandboxed <iframe>
 * gerendert (kein allow-scripts), also doppelt abgesichert.
 */
export function sanitizeMailHtml(html, { bilder = false } = {}) {
  let s = String(html || '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(script|style|iframe|object|embed|noscript|template|head|title)\b[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<(link|meta|base)\b[^>]*>/gi, '');
  s = s.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '').replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '').replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');
  s = s.replace(/(href|src|background)\s*=\s*(["']?)\s*javascript:[^"'>\s]*/gi, '$1=$2#');
  let hatExterneBilder = false;
  if (!bilder) {
    s = s.replace(/(<img\b[^>]*?)\ssrc\s*=\s*(["'])(https?:\/\/[^"']+)\2/gi, (_m, pre, q, url) => { hatExterneBilder = true; return `${pre} data-blocked-src=${q}${url}${q}`; });
    // CSS-Hintergrundbilder entschärfen
    s = s.replace(/background(-image)?\s*:\s*url\(([^)]*https?:[^)]*)\)/gi, () => { hatExterneBilder = true; return 'background:none'; });
  }
  return { html: s, hatExterneBilder };
}

/** Volltext einer Mail für die Lese-Ansicht. */
export async function getMessageDetail(konto, id, { bilder = false } = {}) {
  const msg = await gmailFetch(konto, `/messages/${id}?format=full`);
  const h = msg.payload?.headers || [];
  const parts = extractParts(msg.payload, { html: '', text: '', anhaenge: [] });
  const sani = parts.html ? sanitizeMailHtml(parts.html, { bilder }) : { html: null, hatExterneBilder: false };
  const thread = await getThreadVerlauf(konto, msg.threadId).catch(() => []);
  return {
    id, threadId: msg.threadId,
    from: hdr(h, 'From'), fromEmail: emailAus(hdr(h, 'From')),
    subject: hdr(h, 'Subject') || '(kein Betreff)', date: hdr(h, 'Date'),
    html: sani.html, text: parts.text || null,
    bilderBlockiert: sani.hatExterneBilder && !bilder,
    anhaenge: parts.anhaenge.map(a => ({ filename: a.filename, mimeType: a.mimeType, size: a.size, attachmentId: a.attachmentId })),
    thread,
  };
}

/** Letzte 5 Nachrichten des Threads (Verlauf, kompakt). */
export async function getThreadVerlauf(konto, threadId) {
  const t = await gmailFetch(konto, `/threads/${threadId}?format=metadata&metadataHeaders=From&metadataHeaders=Date`);
  return (t.messages || []).map(m => {
    const hh = m.payload?.headers || [];
    return { id: m.id, from: hdr(hh, 'From'), date: hdr(hh, 'Date'), snippet: m.snippet || '' };
  }).slice(-5);
}

/** Gmail-Entwurf löschen. */
export async function deleteDraft(konto, draftId) {
  return gmailFetch(konto, `/drafts/${draftId}`, { method: 'DELETE' });
}

/** Anhang-Rohdaten (Buffer) für die auth-geschützte Proxy-Route. */
export async function getAttachment(konto, messageId, attachmentId) {
  const att = await gmailFetch(konto, `/messages/${messageId}/attachments/${attachmentId}`);
  if (!att?.data) throw new Error('Anhang leer.');
  return Buffer.from(att.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/* ═══════════════════ Scanner-/Weiterleitungs-Helfer (Qonto) ═══════════════════ */

/** Nachrichten-IDs zu einer Query. */
export async function listMessageIds(konto, query, max = 60) {
  const r = await gmailFetch(konto, `/messages?q=${encodeURIComponent(query)}&maxResults=${max}`);
  return (r.messages || []).map(m => m.id);
}

/** Leichte Scan-Sicht: From/To/Subject/snippet/headers + PDF-Anhänge (filename/attachmentId/size). */
export async function getMessageForScan(konto, id) {
  const msg = await gmailFetch(konto, `/messages/${id}?format=full`);
  const h = msg.payload?.headers || [];
  const parts = extractParts(msg.payload, { html: '', text: '', anhaenge: [] });
  const pdfs = parts.anhaenge.filter(a => /\.pdf$/i.test(a.filename) || a.mimeType === 'application/pdf');
  return {
    id, threadId: msg.threadId,
    from: hdr(h, 'From'), fromEmail: emailAus(hdr(h, 'From')),
    to: hdr(h, 'To'), toDomain: emailAus(hdr(h, 'To')).split('@')[1] || '',
    subject: hdr(h, 'Subject') || '', snippet: msg.snippet || '',
    headers: Object.fromEntries(h.map(x => [x.name.toLowerCase(), x.value])),
    labelIds: msg.labelIds || [], pdfs,
  };
}

/** Label-ID sicherstellen (anlegen, falls nicht vorhanden). */
export async function ensureLabel(konto, name) {
  const r = await gmailFetch(konto, '/labels');
  const found = (r.labels || []).find(l => l.name === name);
  if (found) return found.id;
  const created = await gmailFetch(konto, '/labels', { method: 'POST', body: JSON.stringify({ name, labelListVisibility: 'labelShow', messageListVisibility: 'show' }) });
  return created.id;
}

/** Label an eine Nachricht hängen. */
export async function addLabel(konto, messageId, labelId) {
  return gmailFetch(konto, `/messages/${messageId}/modify`, { method: 'POST', body: JSON.stringify({ addLabelIds: [labelId] }) });
}

/** Rohnachricht (RFC822, base64url) senden. */
export async function sendRawMail(konto, raw) {
  return gmailFetch(konto, '/messages/send', { method: 'POST', body: JSON.stringify({ raw }) });
}

/** Forward-MIME mit PDF-Anhängen bauen (multipart/mixed). attachments: [{filename, contentBase64}]. */
export function buildForwardRaw({ from, to, subject, text, attachments = [] }) {
  const boundary = 'b_' + randomUUID().replace(/-/g, '');
  const betreff = /^(fwd|wg):/i.test(subject || '') ? subject : `Fwd: ${subject || ''}`;
  const lines = [
    `From: ${from}`, `To: ${to}`, `Subject: ${betreff}`, 'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: 8bit', '', text || '', '',
  ];
  for (const a of attachments) {
    lines.push(`--${boundary}`,
      `Content-Type: application/pdf; name="${a.filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${a.filename}"`, '',
      (a.contentBase64 || '').replace(/(.{76})/g, '$1\r\n'), '');
  }
  lines.push(`--${boundary}--`, '');
  return b64url(lines.join('\r\n'));
}

export { ladeKontoRow };
