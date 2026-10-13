// /api/gmail/* — Phase 2: Gmail-OAuth-Verbindungen + „Wichtige Mails" + Antwort-
// vorschläge mit Ein-Klick-Senden. Callback ist PUBLIC (Google-Redirect im Browser);
// alle anderen Routen Admin-only. NIEMALS automatischer Versand — nur auf Klick.

import { Router } from 'express';
import { randomUUID, randomBytes } from 'node:crypto';
import { supabase } from '../supabase.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { anrede, anredeForm } from '../anrede.js';
import { callClaudeWithRetry } from '../claude.js';
import {
  buildAuthUrl, exchangeCode, saveKonto, listKonten, deleteKonto, ladeKontoRow,
  listWichtigeMails, getMessageFull, sendReply, createDraftReply, getOAuthConfig,
} from '../gmail.js';
import { enrichMails, kundeAusKontext } from '../mail-context.js';

const router = Router();
const CLAUDE_MODEL = 'claude-sonnet-4-6';
const adminGuard = [requireAuth, requireAdmin];

// Kurzlebige OAuth-States (CSRF) — Single-Instance-Backend, In-Memory genügt.
const stateStore = new Map();
function neuerState(email) { const s = randomBytes(16).toString('hex'); stateStore.set(s, { email, ts: Date.now() }); return s; }
function konsumState(s) {
  const e = stateStore.get(s); stateStore.delete(s);
  if (!e || Date.now() - e.ts > 10 * 60 * 1000) return null;
  return e;
}

/* ───── OAuth: Verbinden ───── */
router.get('/oauth/start', ...adminGuard, async (req, res) => {
  const cfg = await getOAuthConfig();
  if (!cfg.configured) return res.status(400).json({ error: 'Google-OAuth-Client (Client-ID/Secret) ist noch nicht hinterlegt.' });
  const url = await buildAuthUrl(neuerState(req.user.email));
  res.json({ url });
});

// PUBLIC — Google leitet den Browser hierher zurück.
router.get('/oauth/callback', async (req, res) => {
  const { code, state, error } = req.query || {};
  const back = (msg, ok) => res.redirect(`/admin/gmail?${ok ? 'verbunden' : 'fehler'}=${encodeURIComponent(msg)}`);
  if (error) return back(String(error), false);
  const st = state ? konsumState(String(state)) : null;
  if (!st) return back('Ungültiger oder abgelaufener Vorgang.', false);
  try {
    const { tok, email } = await exchangeCode(String(code));
    await saveKonto({ email, tokens: tok, connectedBy: st.email });
    return back(email || 'Konto', true);
  } catch (e) {
    console.error('[gmail/callback]', e.message);
    return back(e.message, false);
  }
});

/* ───── Verbindungsverwaltung ───── */
router.get('/konten', ...adminGuard, async (req, res) => {
  const cfg = await getOAuthConfig();
  res.json({ configured: cfg.configured, redirect: cfg.redirect, konten: await listKonten() });
});
router.delete('/konten/:id', ...adminGuard, async (req, res) => {
  await deleteKonto(req.params.id); res.json({ ok: true });
});

/* ───── Wichtige Mails (ungelesen INBOX) + Kontext ───── */
router.get('/wichtige', ...adminGuard, async (req, res) => {
  try {
    const konten = (await listKonten()).filter(k => k.status === 'aktiv');
    if (!konten.length) return res.json({ konten: 0, mails: [] });
    let mails = [];
    for (const kMeta of konten) {
      const konto = await ladeKontoRow(kMeta.id);
      try { mails.push(...await listWichtigeMails(konto, { max: 15 })); }
      catch (e) { console.warn('[gmail/wichtige]', kMeta.email, e.message); }
    }
    mails = await enrichMails(mails);
    mails.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
    res.json({ konten: konten.length, mails });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

/* ───── KI-Antwortvorschlag (nur die angezeigte Mail als KI-Input) ───── */
router.post('/vorschlag', ...adminGuard, async (req, res) => {
  const { kontoId, messageId } = req.body || {};
  if (!kontoId || !messageId) return res.status(400).json({ error: 'kontoId/messageId fehlt.' });
  try {
    const konto = await ladeKontoRow(kontoId);
    if (!konto) return res.status(404).json({ error: 'Konto nicht gefunden.' });
    const msg = await getMessageFull(konto, messageId);
    const [withCtx] = await enrichMails([{ fromEmail: msg.fromEmail }]);
    const ctx = withCtx.kontext;

    // Anrede-Form: EINE Quelle anrede()/anredeForm() aus dem Kunden-Kontext.
    const kunde = kundeAusKontext(ctx);
    const gruss = kunde ? anrede(kunde) : (ctx?.typ === 'bewerber' ? `Hallo ${(ctx.name || '').split(' ')[0] || ''}`.trim() : 'Guten Tag');
    const form = kunde ? anredeForm(kunde) : 'sie';

    let ctxText, hinweis = null;
    if (ctx?.typ === 'kunde') {
      ctxText = `CRM-Kontext: Kunde „${ctx.firmenname}". Projektstatus: ${ctx.projekt_status || 'unbekannt'}. Nächster Schritt: ${ctx.naechster_schritt || '—'}. Offene Rechnungen: ${ctx.offene_rechnungen}.`;
    } else if (ctx?.typ === 'bewerber') {
      ctxText = `CRM-Kontext: Bewerber „${ctx.name}" auf „${ctx.job_stelle || '—'}". Telefonisten-Status: ${ctx.telefonisten_status}.`;
    } else {
      ctxText = 'Kein CRM-Kontext — Absender nicht eindeutig zugeordnet.';
      hinweis = 'kein CRM-Kontext';
    }

    const prompt = `Du schreibst eine KURZE, freundliche Antwort-Mail im Stil eines deutschen Recruiting-/Marketing-Dienstleisters. ${form === 'sie' ? 'Siezen' : 'Duzen'}. Beginne GENAU mit dieser Grußzeile als erste Zeile: „${gruss},". Dann 2–5 knappe Sätze, die direkt auf die eingegangene Mail eingehen. Keine erfundenen Fakten, kein Betreff, keine Signatur mit Firmenname (nur „Viele Grüße" + Vorname optional). Nutze den Kontext nur wenn er hilft.

${ctxText}

Eingegangene Mail:
Betreff: ${msg.subject}
---
${msg.bodyText || '(kein Textinhalt)'}
---

Antworte NUR mit dem fertigen Mail-Text (Fließtext, mit der Grußzeile oben).`;

    const resp = await callClaudeWithRetry({ model: CLAUDE_MODEL, max_tokens: 600, messages: [{ role: 'user', content: prompt }] });
    const vorschlag = (resp?.content?.[0]?.text || '').trim();
    res.json({ vorschlag, anrede_quelle: gruss, kontext: ctx, hinweis });
  } catch (e) { console.error('[gmail/vorschlag]', e.message); res.status(502).json({ error: e.message }); }
});

async function logMail({ konto, msg, typ, result, kontext, von }) {
  try {
    await supabase.from('talentone_mail_log').insert({
      konto_email: konto.email, empfaenger: msg.fromEmail, thread_id: msg.threadId,
      message_id: result?.id || result?.message?.id || null, betreff: msg.subject,
      typ, quelle: 'tagesdashboard', kontext: kontext || null, gesendet_von: von || null,
    });
  } catch (e) { console.warn('[gmail/log]', e.message); }
}

/* ───── Senden (im richtigen Thread) ───── */
router.post('/senden', ...adminGuard, async (req, res) => {
  const { kontoId, messageId, text } = req.body || {};
  if (!kontoId || !messageId || !String(text || '').trim()) return res.status(400).json({ error: 'kontoId/messageId/text fehlt.' });
  try {
    const konto = await ladeKontoRow(kontoId);
    if (!konto) return res.status(404).json({ error: 'Konto nicht gefunden.' });
    const msg = await getMessageFull(konto, messageId);
    const result = await sendReply(konto, {
      threadId: msg.threadId, toEmail: msg.fromEmail, subject: msg.subject,
      bodyText: String(text), inReplyTo: msg.messageIdHeader, references: msg.references,
    });
    const [withCtx] = await enrichMails([{ fromEmail: msg.fromEmail }]);
    await logMail({ konto, msg, typ: 'antwort', result, kontext: withCtx.kontext, von: req.user.email });
    res.json({ ok: true, id: result.id, threadId: result.threadId });
  } catch (e) { console.error('[gmail/senden]', e.message); res.status(502).json({ error: e.message }); }
});

/* ───── Als Gmail-Entwurf ablegen ───── */
router.post('/draft', ...adminGuard, async (req, res) => {
  const { kontoId, messageId, text } = req.body || {};
  if (!kontoId || !messageId || !String(text || '').trim()) return res.status(400).json({ error: 'kontoId/messageId/text fehlt.' });
  try {
    const konto = await ladeKontoRow(kontoId);
    if (!konto) return res.status(404).json({ error: 'Konto nicht gefunden.' });
    const msg = await getMessageFull(konto, messageId);
    const result = await createDraftReply(konto, {
      threadId: msg.threadId, toEmail: msg.fromEmail, subject: msg.subject,
      bodyText: String(text), inReplyTo: msg.messageIdHeader, references: msg.references,
    });
    const [withCtx] = await enrichMails([{ fromEmail: msg.fromEmail }]);
    await logMail({ konto, msg, typ: 'draft', result, kontext: withCtx.kontext, von: req.user.email });
    res.json({ ok: true, draft_id: result.id });
  } catch (e) { console.error('[gmail/draft]', e.message); res.status(502).json({ error: e.message }); }
});

/* ───── Google-OAuth-Client-Konfig (Admin) — maskiert via /keys-Logik ───── */
router.put('/config/:name', ...adminGuard, async (req, res) => {
  const allow = ['google_oauth_client_id', 'google_oauth_client_secret', 'google_oauth_redirect'];
  if (!allow.includes(req.params.name)) return res.status(400).json({ error: 'Unbekannt.' });
  const { setSecret, secretStatus } = await import('../settings-secrets.js');
  const wert = String(req.body?.wert || '').trim();
  if (!wert) return res.status(400).json({ error: 'Wert fehlt.' });
  await setSecret(req.params.name, wert, req.user.email);
  res.json({ ok: true, status: await secretStatus(req.params.name) });
});
router.get('/config', ...adminGuard, async (req, res) => {
  const { secretStatus } = await import('../settings-secrets.js');
  const cfg = await getOAuthConfig();
  res.json({
    redirect: cfg.redirect,
    client_id: await secretStatus('google_oauth_client_id'),
    client_secret: await secretStatus('google_oauth_client_secret'),
  });
});

export default router;
