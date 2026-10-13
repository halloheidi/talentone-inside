// Gmail-Anbindung (Heute-Dashboard, Phase 2) — Mehrkonten-OAuth + Lesen + Antworten.
// Ohne googleapis-Dependency: reine REST-Calls per fetch (wie google-sheets.js).
// Per-NUTZER-OAuth (nicht Service-Account!). NIEMALS automatischer Versand — nur
// auf expliziten Klick aus dem Dashboard; jeder Versand wird protokolliert.

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
  return res.json();
}

const hdr = (headers, name) => (headers || []).find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
const emailAus = (from) => { const m = String(from).match(/<([^>]+)>/); return (m ? m[1] : String(from)).trim().toLowerCase(); };

// Header, die für die Relevanz-Klassifizierung gebraucht werden.
const KLASS_HEADERS = ['From', 'Subject', 'Date', 'To', 'List-Unsubscribe', 'List-Id', 'Precedence', 'Auto-Submitted', 'Reply-To'];

/** Ungelesene INBOX-Mails eines Kontos (Metadaten inkl. Klassifizierungs-Header + labelIds). */
export async function listWichtigeMails(konto, { max = 25 } = {}) {
  const list = await gmailFetch(konto, `/messages?q=${encodeURIComponent('is:unread in:inbox')}&maxResults=${max}`);
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
        labelIds: msg.labelIds || [], headers: map,
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

export { ladeKontoRow };
