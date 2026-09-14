// Admin-CRUD für die Kunden-Mail-Vorlagen (talentone_email_templates).
// Übersicht (nach Bereich gruppiert), Editor (Du/Sie · Betreff/Body), Live-
// Vorschau + Test-Mail mit dem Demo-Kunden, sowie „Auf Standard zurücksetzen".
//
// Gemountet unter /api/email-vorlagen mit requireAuth; jede Route zusätzlich
// requireAdmin.

import { Router } from 'express';
import { supabase } from '../supabase.js';
import { requireAdmin } from '../auth.js';
import { getBranding, getMailFrom, getMailReplyTo } from '../branding.js';
import { renderString } from '../email-templates.js';
import { anrede, startsWithGreeting } from '../anrede.js';
import {
  EMAIL_TEMPLATE_BEREICHE,
  EMAIL_TEMPLATE_CATALOG,
  EMAIL_TEMPLATE_CATALOG_BY_KEY,
  demoDatenFor,
} from '../email-template-defaults.js';

const router = Router();
const AGENTUREN = ['talentone', 'nowagwirth'];
const RESEND_API = 'https://api.resend.com/emails';

// Button-Beschriftung, die die jeweilige Mail zusätzlich zum Vorlagen-Text rendert
// (nur für die „ehrliche" Vorschau — schreibgeschützt angezeigt).
const CTA_LABELS = {
  upload_anfrage: '→ Dateien hochladen', upload_anfrage_logo: '→ Logo hochladen', upload_anfrage_fotos: '→ Fotos hochladen',
  daten_pruefung: 'Angaben prüfen & ergänzen →', daten_pruefung_neukunden: 'Angaben prüfen & ergänzen →',
  feedback_anfrage: '⭐ Feedback geben →', avv_anfrage: '→ AVV ansehen & akzeptieren',
  formular_einladung: '→ Formular ausfüllen', formular_einladung_neukunden: '→ Formular ausfüllen',
  zahlung_paypal: '→ Jetzt bezahlen mit PayPal', reaktivierung: '→ Termin buchen (unverbindlich)',
  kampagne_live: '📋 Zur Bewerberliste', entwurf_reminder: '→ Entwürfe ansehen & freigeben',
  kriterien_anfrage: '→ Kriterien eintragen', portal_zugang: '→ Passwort setzen & loslegen',
};

// Literale Grußformel am Anfang (für die Speicher-Warnung) — {{anrede}} ist
// erlaubt (das IST die zentrale Anrede), literale „Hallo …" nicht.
const LITERAL_GRUSS_RE = /^[^\S\r\n]*(hallo|hi|hey|moin|servus|liebe(?:r|s)?|guten\s+(?:tag|morgen|abend)|sehr\s+geehrte)/i;

function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Demo-Kunde „Elektrotechnik Sonnberg GmbH" als Datenquelle für Vorschau/Test.
function demoKunde(agentur, form) {
  return {
    agentur,
    anrede_form: form === 'sie' ? 'sie' : 'du',
    firmenname: 'Elektrotechnik Sonnberg GmbH',
    ansprechpartner: 'Michael Sonnberg',
  };
}

// Wrappt einen gerenderten Intro-/Body-Text in eine schlichte gebrandete Hülle —
// nur für Vorschau + Test-Mail (der echte Versand nutzt die spezifische Hülle
// je Versandstelle).
// „Ehrliche" Vorschau: zeigt AUCH die Schichten, die die Mail zusätzlich zum
// Vorlagen-Text rendert — Begrüßung (Vorspann), Button (CTA) und Abbinder —
// jeweils schreibgeschützt markiert, damit nie wieder eine unsichtbare Textschicht
// am Editor vorbeiläuft (z. B. doppelte Anrede).
function previewShell(brand, form, bodyText, { gruss, ctaLabel } = {}) {
  const paras = String(bodyText || '')
    .split(/\n\s*\n/)
    .map(p => `<p style="font-size:15px;line-height:1.6;color:#2a2a2a;margin:0 0 16px;">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  // Grußzeile nur anzeigen, wenn der Vorlagen-Text nicht schon selbst mit einer
  // (z. B. via {{anrede}}) beginnt — sonst wäre die Vorschau doppelt.
  const zeigeGruss = gruss && !startsWithGreeting(bodyText);
  const roLabel = (txt) => `<div style="font-size:9px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#b48a00;margin:0 0 4px;">🔒 ${escapeHtml(txt)} · automatisch ergänzt</div>`;
  const roBox = 'background:#fffdf5;border:1px dashed #e6cf7a;border-radius:8px;padding:10px 14px;margin:0 0 14px;';
  const grussHtml = zeigeGruss
    ? `<div style="${roBox}">${roLabel('Anrede')}<p style="font-size:15px;line-height:1.55;color:#0a0a0a;margin:0;">${escapeHtml(gruss)},</p></div>` : '';
  const ctaHtml = ctaLabel
    ? `<div style="${roBox}text-align:center;">${roLabel('Button')}<span style="display:inline-block;background:${brand.accent};color:${brand.accentInk};font-weight:700;font-size:14px;padding:11px 24px;border-radius:100px;">${escapeHtml(ctaLabel)}</span></div>` : '';
  const signoffHtml = `<div style="${roBox}">${roLabel('Abbinder')}<p style="font-size:13px;line-height:1.6;color:#0a0a0a;margin:0;font-weight:600;">${form === 'sie' ? 'Ihr' : 'Euer'} ${escapeHtml(brand.name)}-Team</p></div>`;
  return `<!doctype html><html lang="de"><body style="margin:0;padding:0;background:#f0efed;font-family:-apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif;color:#0a0a0a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0efed;padding:32px 0;"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;max-width:600px;width:100%;">
      <tr><td style="background:${brand.primary};padding:24px 32px;">${brand.logoHtml}</td></tr>
      <tr><td style="padding:28px 32px 8px;">
        ${grussHtml}
        ${paras || '<p style="font-size:13px;color:#9a9994;margin:0;">(Der Inhalt dieser Mail wird beim echten Versand dynamisch im Code erzeugt.)</p>'}
        ${ctaHtml}
        ${signoffHtml}
      </td></tr>
      <tr><td style="padding:14px 32px;background:#fafaf8;text-align:center;border-top:1px solid #ececea;">
        <p style="font-size:11px;color:#9a9994;margin:0;">Test-Vorschau · ${escapeHtml(brand.footer)}</p></td></tr>
    </table>
  </td></tr></table></body></html>`;
}

function catalogOr404(key, res) {
  const cat = EMAIL_TEMPLATE_CATALOG_BY_KEY[key];
  if (!cat) { res.status(404).json({ error: `Unbekannter Vorlagen-Key: ${key}` }); return null; }
  return cat;
}
function validAgentur(agentur, res) {
  if (!AGENTUREN.includes(agentur)) { res.status(400).json({ error: `Ungültige Agentur: ${agentur}` }); return false; }
  return true;
}

// ─────────────── Übersicht ───────────────
router.get('/', requireAdmin, async (req, res) => {
  const { data, error } = await supabase.from('talentone_email_templates').select('*');
  if (error) return res.status(500).json({ error: error.message });
  const byKeyAgentur = {};
  for (const row of data || []) byKeyAgentur[`${row.key}::${row.agentur}`] = row;

  const templates = EMAIL_TEMPLATE_CATALOG.map(cat => ({
    key: cat.key,
    bereich: cat.bereich,
    name: cat.name,
    beschreibung: cat.beschreibung,
    platzhalter: cat.platzhalter,
    betreffOnly: cat.betreffOnly,
    rows: {
      talentone: byKeyAgentur[`${cat.key}::talentone`] || null,
      nowagwirth: byKeyAgentur[`${cat.key}::nowagwirth`] || null,
    },
  }));
  res.json({ bereiche: EMAIL_TEMPLATE_BEREICHE, templates });
});

// ─────────────── Speichern (Betreff/Body Du+Sie, aktiv) ───────────────
router.put('/:key/:agentur', requireAdmin, async (req, res) => {
  const { key, agentur } = req.params;
  const cat = catalogOr404(key, res); if (!cat) return;
  if (!validAgentur(agentur, res)) return;

  const b = req.body || {};
  const patch = {
    key, agentur,
    name: cat.name,
    beschreibung: cat.beschreibung,
    platzhalter: cat.platzhalter,
    betreff_du: b.betreff_du ?? null,
    betreff_sie: b.betreff_sie ?? null,
    // Nur-Betreff-Keys behalten immer NULL-Body (der Inhalt entsteht im Code).
    body_du: cat.betreffOnly ? null : (b.body_du ?? null),
    body_sie: cat.betreffOnly ? null : (b.body_sie ?? null),
    aktiv: b.aktiv === undefined ? true : !!b.aktiv,
    updated_at: new Date().toISOString(),
    updated_by: req.user?.email || null,
  };
  const { data, error } = await supabase.from('talentone_email_templates')
    .upsert(patch, { onConflict: 'key,agentur' }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Warnung (nicht blockierend): Vorlagen-Text sollte KEINE eigene Begrüßung
  // enthalten — die „Hallo …,"-Zeile setzt der Renderer zentral. {{anrede}} ist ok.
  const grussFelder = [];
  if (!cat.betreffOnly && LITERAL_GRUSS_RE.test(String(patch.body_du || ''))) grussFelder.push('Du');
  if (!cat.betreffOnly && LITERAL_GRUSS_RE.test(String(patch.body_sie || ''))) grussFelder.push('Sie');
  const warnung = grussFelder.length
    ? `Der Text (${grussFelder.join(' + ')}) beginnt mit einer eigenen Begrüßung. Die Anrede ("Hallo …,") wird automatisch davorgesetzt — bitte die Grußzeile hier entfernen, sonst erscheint sie doppelt. (Für eine personalisierte Anrede den Platzhalter {{anrede}} nutzen.)`
    : null;

  res.json({ template: data, warnung });
});

// ─────────────── Auf Standard zurücksetzen (Seed/Code-Default) ───────────────
router.post('/:key/:agentur/reset', requireAdmin, async (req, res) => {
  const { key, agentur } = req.params;
  const cat = catalogOr404(key, res); if (!cat) return;
  if (!validAgentur(agentur, res)) return;

  const patch = {
    key, agentur,
    name: cat.name,
    beschreibung: cat.beschreibung,
    platzhalter: cat.platzhalter,
    betreff_du: cat.betreff_du,
    betreff_sie: cat.betreff_sie,
    body_du: cat.body_du,
    body_sie: cat.body_sie,
    aktiv: true,
    updated_at: new Date().toISOString(),
    updated_by: req.user?.email || null,
  };
  const { data, error } = await supabase.from('talentone_email_templates')
    .upsert(patch, { onConflict: 'key,agentur' }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ template: data });
});

// ─────────────── Live-Vorschau (rendert Editor-Inhalt mit Demo-Daten) ───────────────
router.post('/:key/:agentur/preview', requireAdmin, (req, res) => {
  const { key, agentur } = req.params;
  const cat = catalogOr404(key, res); if (!cat) return;
  if (!validAgentur(agentur, res)) return;

  const form = req.body?.form === 'sie' ? 'sie' : 'du';
  const kunde = demoKunde(agentur, form);
  const daten = demoDatenFor(key, kunde, form);
  const betreffRaw = req.body?.betreff ?? '';
  const bodyRaw = cat.betreffOnly ? '' : (req.body?.body ?? '');

  const subject = renderString(betreffRaw, kunde, daten, key);
  const body = renderString(bodyRaw, kunde, daten, key);
  const brand = getBranding(agentur);
  const html = previewShell(brand, form, body, { gruss: anrede(kunde), ctaLabel: CTA_LABELS[key] });
  res.json({ subject, body, html, betreffOnly: cat.betreffOnly });
});

// ─────────────── Test-Mail an den eingeloggten Nutzer ───────────────
router.post('/:key/:agentur/test', requireAdmin, async (req, res) => {
  const { key, agentur } = req.params;
  const cat = catalogOr404(key, res); if (!cat) return;
  if (!validAgentur(agentur, res)) return;
  const to = req.user?.email;
  if (!to) return res.status(400).json({ error: 'Keine E-Mail-Adresse für den eingeloggten Nutzer.' });
  if (!process.env.RESEND_API_KEY) return res.status(500).json({ error: 'RESEND_API_KEY nicht gesetzt.' });

  const form = req.body?.form === 'sie' ? 'sie' : 'du';
  const kunde = demoKunde(agentur, form);
  const daten = demoDatenFor(key, kunde, form);
  const brand = getBranding(agentur);
  const subject = renderString(req.body?.betreff ?? cat[`betreff_${form}`] ?? '', kunde, daten, key);
  const bodyRaw = cat.betreffOnly ? '' : (req.body?.body ?? cat[`body_${form}`] ?? '');
  const body = renderString(bodyRaw, kunde, daten, key);
  const html = previewShell(brand, form, body, { gruss: anrede(kunde), ctaLabel: CTA_LABELS[key] });

  try {
    const r = await fetch(RESEND_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: getMailFrom(brand),
        to: [to],
        reply_to: getMailReplyTo(brand),
        subject: `[TEST · ${form.toUpperCase()}] ${subject}`,
        html,
      }),
    });
    if (!r.ok) {
      const txt = await r.text();
      return res.status(502).json({ error: `Resend ${r.status}: ${txt.slice(0, 300)}` });
    }
    res.json({ ok: true, to });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
