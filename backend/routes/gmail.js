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
  istVerteiler, istBeleg, ruleMatches, getCalendarInvite, respondToEvent,
  maschinellerAbsender, threadUnbeantwortet, getMessageDetail, getAttachment,
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

/* ───── Wichtige Mails (ungelesen INBOX) + Kontext + Relevanz-Filter ───── */
// Klassen: 'termin' (Prio 0) / 'crm' (Prio 1) / 'persoenlich' (Prio 2) sichtbar ·
// 'verteiler'/'beleg'/blockiert/einzeln-ausgeblendet → draußen. Kurzer Cache je Nutzer,
// genug Rohmails (max 40/Konto) werden gescannt, damit nach Filter/Ausblenden immer
// möglichst viele RELEVANTE Mails übrig bleiben.
const wichtigeCache = new Map(); // email → {ts,data}
const WICHTIGE_CACHE_MS = 3 * 60 * 1000;
function invalidateWichtige(email) { wichtigeCache.delete(email); }

router.get('/wichtige', ...adminGuard, async (req, res) => {
  const email = req.user.email;
  const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
  const cached = wichtigeCache.get(email);
  if (!refresh && cached && Date.now() - cached.ts < WICHTIGE_CACHE_MS) return res.json(cached.data);
  try {
    const konten = (await listKonten()).filter(k => k.status === 'aktiv');
    if (!konten.length) { const d = { konten: 0, mails: [], ausgeblendet: [] }; wichtigeCache.set(email, { ts: Date.now(), data: d }); return res.json(d); }
    const kontoRows = {};
    const byId = new Map();
    for (const kMeta of konten) {
      const konto = await ladeKontoRow(kMeta.id); kontoRows[konto.email] = konto;
      try {
        // Lese-Fenster: ungelesen ODER (gelesen & jünger als 48h) — damit Mails nicht
        // verschwinden, nur weil sie am Handy angetippt wurden. Unbeantwortet-Check unten.
        const ung = await listWichtigeMails(konto, { query: 'is:unread in:inbox', max: 40 });
        const neu = await listWichtigeMails(konto, { query: 'in:inbox newer_than:2d', max: 40 });
        for (const m of ung) byId.set(`${konto.email}:${m.id}`, m);
        for (const m of neu) if (!byId.has(`${konto.email}:${m.id}`)) byId.set(`${konto.email}:${m.id}`, m);
      } catch (e) { console.warn('[gmail/wichtige]', kMeta.email, e.message); }
    }
    let mails = [...byId.values()];
    // Gelesene Mails nur behalten, wenn unbeantwortet (letzte Thread-Nachricht nicht von mir).
    const geprueft = [];
    for (const m of mails) {
      if (m.ungelesen) { geprueft.push(m); continue; }
      const offen = await threadUnbeantwortet(kontoRows[m.konto_email], m.threadId);
      if (offen) geprueft.push(m);
    }
    mails = await enrichMails(geprueft);
    const [{ data: regeln = [] }, { data: hidden = [] }] = await Promise.all([
      supabase.from('talentone_gmail_absender_regeln').select('muster, regel').eq('nutzer', email),
      supabase.from('talentone_gmail_ausgeblendet').select('message_id').eq('nutzer', email),
    ]);
    const hiddenSet = new Set((hidden || []).map(h => h.message_id));

    const sichtbar = [], ausgeblendet = [];
    for (const m of mails) {
      if (hiddenSet.has(m.id)) continue; // einzeln & dauerhaft ausgeblendet → raus, Platz frei
      const basis = { konto_email: m.konto_email, id: m.id, threadId: m.threadId, from: m.from, fromEmail: m.fromEmail, fromName: (m.from || '').replace(/<[^>]+>/, '').replace(/"/g, '').trim() || m.fromEmail, subject: m.subject, snippet: (m.snippet || '').slice(0, 200), date: m.date, ageTage: m.ageTage, ungelesen: m.ungelesen, important: m.important, link: m.link, kontext: m.kontext };
      const blockR = regeln.find(r => r.regel === 'block' && ruleMatches(r.muster, m.fromEmail));
      const allowR = regeln.find(r => r.regel === 'allow' && ruleMatches(r.muster, m.fromEmail));
      if (blockR) { ausgeblendet.push({ ...basis, grund: 'Blockliste' }); continue; }
      // Termineinladung (METHOD:REQUEST) — NICHT als Beleg/Verteiler filtern, eigener Typ
      // mit RSVP. Antworten/Absagen (REPLY/CANCEL) fallen in die normale Klassifizierung.
      if (m.terminKandidat) {
        let inv = null;
        try { inv = await getCalendarInvite(kontoRows[m.konto_email], m.id); } catch (e) { /* ics evtl. nicht lesbar */ }
        const einladungBetreff = /^\s*(einladung|invitation|updated invitation|aktualisierte einladung)\s*:/i.test(m.subject || '');
        if (inv && inv.method === 'REQUEST') {
          sichtbar.push({ ...basis, prio: 0, klasse: 'termin', termin: { titel: inv.titel, start: inv.start, organizer: inv.organizer, iCalUID: inv.iCalUID, method: inv.method } });
          continue;
        }
        if (!inv && einladungBetreff) { // Einladung ohne lesbare .ics → anzeigen, aber ohne RSVP
          sichtbar.push({ ...basis, prio: 0, klasse: 'termin', termin: { titel: m.subject, start: null, organizer: m.from, iCalUID: null } });
          continue;
        }
        // sonst: normal weiterklassifizieren (REPLY/CANCEL/kein Invite)
      }
      if (m.kontext) { sichtbar.push({ ...basis, prio: 1, klasse: 'crm' }); continue; } // CRM bleibt unangetastet
      // GRUNDREGEL: individuell geschriebene Mails echter Personen NIE durch eine
      // Heuristik filtern (im Zweifel anzeigen). Signal: Gmail-Kategorie PERSONAL ODER
      // Antwort-Betreff (Re:/AW:/…), aber NICHT automatisiert und KEIN maschineller Absender.
      const auto = (m.headers['auto-submitted'] || '').toLowerCase();
      const istAuto = auto && auto !== 'no';
      const replyPrefix = /^\s*(re|aw|wg|antw|antwort)\s*:/i.test(m.subject || '');
      const individuell = ((m.labelIds || []).includes('CATEGORY_PERSONAL') || replyPrefix) && !istAuto && !maschinellerAbsender(m.fromEmail);
      if (individuell) { sichtbar.push({ ...basis, prio: 2, klasse: 'persoenlich', individuell: true }); continue; }
      const v = istVerteiler(m);
      const cls = v.bulk ? v : istBeleg(m);
      if (cls.bulk && !allowR) { ausgeblendet.push({ ...basis, grund: cls.grund }); continue; }
      sichtbar.push({ ...basis, prio: 2, klasse: 'persoenlich', ...(allowR ? { allow: true } : {}) });
    }
    sichtbar.sort((a, b) => (a.prio - b.prio) || ((Date.parse(b.date) || 0) - (Date.parse(a.date) || 0)));
    ausgeblendet.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
    const data = { konten: konten.length, mails: sichtbar, ausgeblendet };
    wichtigeCache.set(email, { ts: Date.now(), data });
    res.json(data);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

/* ───── Einzelne Mail dauerhaft ausblenden (pro Nutzer+message_id) ───── */
router.post('/ausblenden', ...adminGuard, async (req, res) => {
  const message_id = String(req.body?.message_id || '').trim();
  if (!message_id) return res.status(400).json({ error: 'message_id fehlt.' });
  const { error } = await supabase.from('talentone_gmail_ausgeblendet')
    .upsert({ nutzer: req.user.email, message_id }, { onConflict: 'nutzer,message_id' });
  if (error) return res.status(500).json({ error: error.message });
  invalidateWichtige(req.user.email);
  res.json({ ok: true });
});
router.delete('/ausblenden/:message_id', ...adminGuard, async (req, res) => {
  await supabase.from('talentone_gmail_ausgeblendet').delete().eq('nutzer', req.user.email).eq('message_id', req.params.message_id);
  invalidateWichtige(req.user.email);
  res.json({ ok: true });
});

/* ───── Termin-RSVP (Annehmen/Vielleicht/Ablehnen) ───── */
router.post('/termin/antwort', ...adminGuard, async (req, res) => {
  const { kontoId, messageId, status } = req.body || {};
  const map = { annehmen: 'accepted', vielleicht: 'tentative', ablehnen: 'declined', accepted: 'accepted', tentative: 'tentative', declined: 'declined' };
  const responseStatus = map[status];
  if (!kontoId || !messageId || !responseStatus) return res.status(400).json({ error: 'kontoId/messageId/status fehlt oder ungültig.' });
  try {
    const konto = await ladeKontoRow(kontoId);
    if (!konto) return res.status(404).json({ error: 'Konto nicht gefunden.' });
    const inv = await getCalendarInvite(konto, messageId);
    if (!inv?.iCalUID) return res.status(422).json({ error: 'Keine Termin-Kennung (iCalUID) in der Mail gefunden.' });
    const r = await respondToEvent(konto, { iCalUID: inv.iCalUID, responseStatus });
    invalidateWichtige(req.user.email);
    res.json({ ok: true, responseStatus: r.responseStatus });
  } catch (e) {
    const scopeFehlt = e.status === 403 || /insufficient|scope|permission/i.test(e.message || '');
    res.status(502).json({ error: scopeFehlt ? 'Kalender-Zugriff fehlt — Konto unter /admin/gmail neu verbinden (Scope calendar.events).' : e.message });
  }
});

/* ───── Absender-Regeln (block/allow) pro Nutzer ───── */
router.get('/regeln', ...adminGuard, async (req, res) => {
  const { data } = await supabase.from('talentone_gmail_absender_regeln')
    .select('id, muster, regel, created_at').eq('nutzer', req.user.email).order('created_at', { ascending: false });
  res.json({ regeln: data || [] });
});
router.post('/regeln', ...adminGuard, async (req, res) => {
  const muster = String(req.body?.muster || '').trim().toLowerCase();
  const regel = req.body?.regel === 'allow' ? 'allow' : 'block';
  if (!muster) return res.status(400).json({ error: 'muster fehlt.' });
  const { error } = await supabase.from('talentone_gmail_absender_regeln')
    .upsert({ nutzer: req.user.email, muster, regel }, { onConflict: 'nutzer,muster' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});
router.delete('/regeln/:id', ...adminGuard, async (req, res) => {
  await supabase.from('talentone_gmail_absender_regeln').delete().eq('id', req.params.id).eq('nutzer', req.user.email);
  res.json({ ok: true });
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

/* ───── Lese-Ansicht: Volltext (sanitized) + Thread + CRM-Kontext ───── */
router.get('/nachricht', ...adminGuard, async (req, res) => {
  const { kontoId, messageId } = req.query || {};
  const bilder = req.query.bilder === '1' || req.query.bilder === 'true';
  if (!kontoId || !messageId) return res.status(400).json({ error: 'kontoId/messageId fehlt.' });
  try {
    const konto = await ladeKontoRow(kontoId);
    if (!konto) return res.status(404).json({ error: 'Konto nicht gefunden.' });
    const detail = await getMessageDetail(konto, messageId, { bilder });
    const [withCtx] = await enrichMails([{ fromEmail: detail.fromEmail }]);
    res.json({ ...detail, kontext: withCtx.kontext });
  } catch (e) { console.error('[gmail/nachricht]', e.message); res.status(502).json({ error: e.message }); }
});

/* ───── Anhang-Download (auth-geschützter Proxy, Muster Bewerber-Anhänge) ───── */
router.get('/anhang', ...adminGuard, async (req, res) => {
  const { kontoId, messageId, attachmentId } = req.query || {};
  const filename = (req.query.filename || 'anhang').toString().replace(/[^\w.\-() ]+/g, '_').slice(0, 120);
  if (!kontoId || !messageId || !attachmentId) return res.status(400).json({ error: 'Parameter fehlen.' });
  try {
    const konto = await ladeKontoRow(kontoId);
    if (!konto) return res.status(404).json({ error: 'Konto nicht gefunden.' });
    const buf = await getAttachment(konto, messageId, attachmentId);
    res.setHeader('Content-Type', (req.query.mimeType || 'application/octet-stream').toString());
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (e) { console.error('[gmail/anhang]', e.message); res.status(502).json({ error: e.message }); }
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
