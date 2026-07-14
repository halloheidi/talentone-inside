// Portal-Auth: Passwort-Hash (scrypt) + signed Session-Cookie (HMAC).
// Ohne externe Deps — nutzt nur Node-Built-ins.

import crypto from 'node:crypto';

const SCRYPT_N = 16384;
const SCRYPT_KEYLEN = 64;
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 Tage

function getSecret() {
  const s = process.env.PORTAL_SESSION_SECRET;
  if (!s || s.length < 20) {
    console.warn('[portal-auth] PORTAL_SESSION_SECRET fehlt oder zu kurz — Sessions werden bei Restart ungültig.');
    // Fallback: prozess-lokaler Zufalls-Secret. Reicht bis zum naechsten Restart.
    if (!global.__PORTAL_FALLBACK_SECRET) {
      global.__PORTAL_FALLBACK_SECRET = crypto.randomBytes(48).toString('hex');
    }
    return global.__PORTAL_FALLBACK_SECRET;
  }
  return s;
}

/* ── Passwörter ── */

export async function hashPassword(pwd) {
  const salt = crypto.randomBytes(16);
  const hash = await new Promise((resolve, reject) => {
    crypto.scrypt(pwd, salt, SCRYPT_KEYLEN, { N: SCRYPT_N }, (err, derived) =>
      err ? reject(err) : resolve(derived));
  });
  return `scrypt$${SCRYPT_N}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(pwd, stored) {
  if (!stored || !pwd) return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const N = parseInt(parts[1], 10);
  const salt = Buffer.from(parts[2], 'hex');
  const expected = Buffer.from(parts[3], 'hex');
  const derived = await new Promise((resolve, reject) => {
    crypto.scrypt(pwd, salt, expected.length, { N }, (err, d) => err ? reject(err) : resolve(d));
  });
  return crypto.timingSafeEqual(derived, expected);
}

/* ── Session Cookie ── */

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function base64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

export function signSession(payload) {
  const body = base64url(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SEC }));
  const sig = base64url(crypto.createHmac('sha256', getSecret()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifySessionValue(value) {
  if (!value || typeof value !== 'string' || !value.includes('.')) return null;
  const [body, sig] = value.split('.');
  const expected = base64url(crypto.createHmac('sha256', getSecret()).update(body).digest());
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(base64urlDecode(body).toString('utf8'));
    if (data.exp && data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch { return null; }
}

/* ── Cookie-Handling ── */

// Der Cookie ist pro Kunden-Portal-Token separat (verschiedene Kunden im
// gleichen Browser laufen nicht in dieselbe Session).
export function cookieName(kundeId) {
  return `pf_${String(kundeId).replace(/-/g, '').slice(0, 24)}`;
}

export function readSessionCookie(req, kundeId) {
  const raw = req.headers?.cookie || '';
  const name = cookieName(kundeId);
  const match = raw.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  if (!match) return null;
  return verifySessionValue(match.slice(name.length + 1));
}

export function setSessionCookie(res, kundeId, session) {
  const value = signSession(session);
  const parts = [
    `${cookieName(kundeId)}=${value}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${SESSION_MAX_AGE_SEC}`,
  ];
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res, kundeId) {
  res.setHeader('Set-Cookie', `${cookieName(kundeId)}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
}
