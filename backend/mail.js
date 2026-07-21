// Mail-Versand via Resend für TalentOne Inside.
// Branding pro Agentur via getBranding() / getMailFrom() / getMailReplyTo().

import { getBranding, getMailFrom, getMailReplyTo, getOfferMailFrom, getOfferMailReplyTo, agenturForOfferBrand } from './branding.js';
import { anrede, t } from './anrede.js';

const RESEND_API = 'https://api.resend.com/emails';

// Intern (Mitarbeiter-Benachrichtigungen) — immer TalentOne-Absender
const INTERNAL_FROM = 'TalentOne Inside <noreply@talent-one.de>';

/**
 * Interne BCC-Liste — geht bei jeder Kunden-Mail mit, unsichtbar.
 * Konfiguriert via INTERNAL_BCC env var (Komma-getrennt). Fallback:
 * info@nowagwirth.de + andrea.saltaleggio@nowagwirth.de.
 * Optional extra-Empfänger (z.B. Jessica bei Vorqualifizierung).
 * Filtert leere Strings + Duplikate, und schließt die `to`-Empfänger aus,
 * damit niemand doppelt zugestellt wird.
 */
export function getInternalBcc(extra = [], excludeTo = []) {
  const fromEnv = (process.env.INTERNAL_BCC ?? 'info@nowagwirth.de,andrea.saltaleggio@nowagwirth.de')
    .split(',').map(s => s.trim()).filter(Boolean);
  const extras = Array.isArray(extra) ? extra : (extra ? [extra] : []);
  const exclude = new Set((Array.isArray(excludeTo) ? excludeTo : [excludeTo]).filter(Boolean).map(s => s.toLowerCase()));
  const merged = [...fromEnv, ...extras.filter(Boolean)];
  const seen = new Set();
  const out = [];
  for (const addr of merged) {
    const l = addr.toLowerCase();
    if (seen.has(l) || exclude.has(l)) continue;
    seen.add(l); out.push(addr);
  }
  return out;
}

function escape(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function brandedShell({ brand, contentHtml }) {
  return `<!doctype html>
<html lang="de">
<body style="margin:0;padding:0;background:#f0efed;font-family:-apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif;color:#0a0a0a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0efed;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;max-width:600px;width:100%;">
        <tr><td style="background:${brand.primary};padding:24px 32px;">${brand.logoHtml}</td></tr>
        ${contentHtml}
        <tr><td style="padding:14px 32px;background:#fafaf8;text-align:center;border-top:1px solid #ececea;">
          <p style="font-size:11px;color:#9a9994;margin:0;">${escape(brand.footer)} · <a href="${brand.websiteUrl}" style="color:#5a5955;text-decoration:none;border-bottom:1px dotted #c0bfba;">${escape(brand.websiteUrl.replace(/^https?:\/\//, ''))}</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// umfang: 'beides' (Logo + Fotos) | 'logo' (nur Logo) | 'fotos' (nur Fotos)
export async function sendUploadAnfrage({ to, kunde, kundenname, ansprechpartner, uploadUrl, customText, agentur, umfang = 'beides' }) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY nicht gesetzt.');
  }
  const brand = getBranding(agentur);
  // Anrede zentral — kunde traegt anrede_form/anrede_titel/nachname.
  const k = kunde || { ansprechpartner };
  const grusszeile = anrede(k);

  const wantLogo  = umfang !== 'fotos';
  const wantFotos = umfang !== 'logo';

  const subject = umfang === 'logo'
    ? t(k, 'Wir brauchen noch euer Logo für die Kampagne', 'Wir brauchen noch Ihr Logo für die Kampagne')
    : umfang === 'fotos'
      ? t(k, 'Wir brauchen noch ein paar Fotos für eure Kampagne', 'Wir brauchen noch ein paar Fotos für Ihre Kampagne')
      : t(k, 'Wir brauchen noch Logo und Fotos für eure Kampagne', 'Wir brauchen noch Logo und Fotos für Ihre Kampagne');

  const defaultIntro = umfang === 'logo'
    ? t(k, `wir bereiten gerade eure Recruiting-Kampagne vor und brauchen dafür noch euer Logo. Über den unten stehenden Link könnt ihr es ganz einfach hochladen.`,
          `wir bereiten gerade Ihre Recruiting-Kampagne vor und brauchen dafür noch Ihr Logo. Über den unten stehenden Link können Sie es ganz einfach hochladen.`)
    : umfang === 'fotos'
      ? t(k, `wir bereiten gerade eure Recruiting-Kampagne vor und brauchen dafür noch ein paar Fotos vom Team / Arbeitsplatz. Über den unten stehenden Link könnt ihr sie ganz einfach hochladen.`,
            `wir bereiten gerade Ihre Recruiting-Kampagne vor und brauchen dafür noch ein paar Fotos vom Team / Arbeitsplatz. Über den unten stehenden Link können Sie sie ganz einfach hochladen.`)
      : t(k, `wir bereiten gerade eure Recruiting-Kampagne vor und brauchen dafür ein paar Materialien von euch. Über den unten stehenden Link könnt ihr ganz einfach euer Logo und Fotos vom Team / Arbeitsplatz hochladen.`,
            `wir bereiten gerade Ihre Recruiting-Kampagne vor und brauchen dafür ein paar Materialien von Ihnen. Über den unten stehenden Link können Sie ganz einfach Ihr Logo und Fotos vom Team / Arbeitsplatz hochladen.`);
  const intro = (customText || '').trim() || defaultIntro;

  const bulletLogo  = `<li><strong>${t(k, 'Euer Logo', 'Ihr Logo')}</strong> in guter Qualität (PNG, JPG, SVG)</li>`;
  const bulletFotos = `<li><strong>3–5 Fotos vom Arbeitsplatz, Team oder typische Tätigkeiten</strong> — gerne auch Handy-Schnappschüsse</li>`;
  const bulletsHtml = [wantLogo && bulletLogo, wantFotos && bulletFotos].filter(Boolean).join('\n        ');

  const ctaLabel = umfang === 'logo' ? '→ Logo hochladen'
    : umfang === 'fotos' ? '→ Fotos hochladen'
      : '→ Dateien hochladen';

  const content = `
    <tr><td style="padding:28px 32px 8px;">
      <p style="font-size:15px;line-height:1.55;color:#0a0a0a;margin:0 0 14px;">${escape(grusszeile)},</p>
      <p style="font-size:15px;line-height:1.6;color:#2a2a2a;margin:0 0 18px;">${escape(intro).replace(/\n/g, '<br>')}</p>
      <p style="font-size:14px;line-height:1.6;color:#2a2a2a;margin:0 0 22px;">Was wir uns wünschen würden:</p>
      <ul style="font-size:14px;line-height:1.7;color:#2a2a2a;margin:0 0 24px;padding-left:18px;">
        ${bulletsHtml}
      </ul>
    </td></tr>
    <tr><td align="center" style="padding:0 32px 28px;">
      <a href="${escape(uploadUrl)}" style="display:inline-block;background:${brand.accent};color:${brand.accentInk};text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:100px;letter-spacing:0.02em;">${ctaLabel}</a>
      <p style="font-size:11px;color:#9a9994;margin:14px 0 0;">Der Link ist persönlich und nur für ${escape(kundenname)} gültig.</p>
    </td></tr>
    <tr><td style="padding:0 32px 24px;">
      <p style="font-size:13px;line-height:1.6;color:#5a5955;margin:0;">Falls etwas unklar ist, einfach auf diese Mail antworten — wir helfen gern.<br>Vielen Dank im Voraus!</p>
      <p style="font-size:13px;line-height:1.6;color:#0a0a0a;margin:14px 0 0;font-weight:600;">Euer ${escape(brand.name)}-Team</p>
    </td></tr>`;

  const html = brandedShell({ brand, contentHtml: content });
  const textBullets = [
    wantLogo && t(k, '• Euer Logo (PNG/JPG/SVG)', '• Ihr Logo (PNG/JPG/SVG)'),
    wantFotos && '• 3-5 Fotos vom Arbeitsplatz, Team oder typischen Tätigkeiten',
  ].filter(Boolean).join('\n');
  const text = `${grusszeile},\n\n${intro}\n\nWas wir uns wünschen:\n${textBullets}\n\nUpload-Link: ${uploadUrl}\n\n(Der Link ist persönlich und nur für ${kundenname} gültig.)\n\nVielen Dank!\n${t(k, 'Euer', 'Ihr')} ${brand.name}-Team`;

  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: getMailFrom(brand),
      to,
      bcc: getInternalBcc([], [to].flat()),
      reply_to: getMailReplyTo(brand),
      subject,
      html,
      text,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend ${response.status}: ${body.slice(0, 300)}`);
  }
  return await response.json();
}

/* ─────────────────── AVV-Bestätigung (mit PDF-Anhang) ─────────────────── */
export async function sendAvvBestaetigung({ to, kunde, version, akzeptiert_von, akzeptiert_am }) {
  if (!process.env.RESEND_API_KEY) return null;
  const brand = getBranding(kunde?.agentur);
  const firma = escape(kunde?.firmenname || '');
  const datum = new Date(akzeptiert_am || Date.now()).toLocaleString('de-DE', { dateStyle: 'long', timeStyle: 'short' });
  // Du: Vorname der Person, die akzeptiert hat. Sie: Titel+Nachname vom Kunden
  // (bzw. "Guten Tag", wenn nicht ermittelbar) — vorher war das eine Mischform
  // ("Hallo <Vorname>," + "Sie haben ...").
  const grusszeile = t(kunde,
    `Hallo ${(akzeptiert_von || '').toString().split(' ')[0] || 'zusammen'}`,
    anrede(kunde));

  const content = `
    <h1 style="font-size:22px;font-weight:700;letter-spacing:-0.02em;margin:0 0 6px;color:#0a0a0a;">Auftragsverarbeitungsvertrag bestätigt</h1>
    <p style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9a9994;margin:0 0 22px;">Version ${escape(version.version)}</p>
    <p style="font-size:14px;line-height:1.6;color:#2a2a2a;margin:0 0 14px;">${escape(grusszeile)},</p>
    <p style="font-size:14px;line-height:1.6;color:#2a2a2a;margin:0 0 14px;">${t(kunde, 'vielen Dank — du hast den Auftragsverarbeitungsvertrag (AVV) im Namen von', 'vielen Dank — Sie haben den Auftragsverarbeitungsvertrag (AVV) im Namen von')} <strong>${firma}</strong> akzeptiert.</p>
    <div style="margin:0 0 18px;padding:16px;background:#fafaf8;border:1px solid #ececea;border-radius:8px;font-size:13px;line-height:1.7;color:#2a2a2a;">
      <div><strong>Akzeptiert von:</strong> ${escape(akzeptiert_von || '—')}</div>
      <div><strong>Zeitpunkt:</strong> ${escape(datum)}</div>
      <div><strong>Version:</strong> ${escape(version.version)}</div>
    </div>
    <p style="font-size:14px;line-height:1.6;color:#2a2a2a;margin:0 0 14px;">${t(kunde, 'Deine Kopie des Vertrags findest du im Anhang dieser E-Mail — bitte für deine Unterlagen aufbewahren.', 'Ihre Kopie des Vertrags finden Sie im Anhang dieser E-Mail — bitte für Ihre Unterlagen aufbewahren.')}</p>
    <p style="font-size:13px;line-height:1.6;color:#0a0a0a;margin:14px 0 0;font-weight:600;">${t(kunde, 'Euer', 'Ihr')} ${escape(brand.name)}-Team</p>
  `;
  const html = brandedShell({ brand, contentHtml: content });

  // PDF als Anhang laden (best-effort — ohne Anhang trotzdem senden).
  let attachments;
  try {
    const r = await fetch(version.pdf_url);
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      const fn = `AVV_${brand.name.replace(/[^\w]+/g, '_')}_v${version.version}.pdf`;
      attachments = [{ filename: fn, content: buf.toString('base64') }];
    }
  } catch (e) { console.warn('[avv-mail] PDF-Anhang:', e.message); }

  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: getMailFrom(brand),
      to: [to].flat(),
      bcc: getInternalBcc([], [to].flat()),
      reply_to: getMailReplyTo(brand),
      subject: `Ihre AVV-Kopie für die Unterlagen (${brand.name})`,
      html,
      ...(attachments ? { attachments } : {}),
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend ${response.status}: ${body.slice(0, 300)}`);
  }
  return await response.json();
}

/* ─────────────────── Formular-Einladung an Kunde ─────────────────── */

export async function sendFormularEinladung({ to, kunde, ansprechpartner, formularUrl, customText, agentur, projekttyp }) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY nicht gesetzt.');
  const brand = getBranding(agentur);
  const k = kunde || { ansprechpartner };
  const grusszeile = anrede(k);
  const isNeukunden = projekttyp === 'neukundengewinnung';

  const defaultIntro = isNeukunden
    ? t(k, `wir freuen uns auf eure Neukunden-Kampagne! Damit wir starten können, haben wir ein kurzes Briefing-Formular für euch vorbereitet — dort tragt ihr alles rund um euer Angebot, eure Zielgruppe und euer Unternehmen ein. Dauert etwa 10 Minuten.`,
            `wir freuen uns auf Ihre Neukunden-Kampagne! Damit wir starten können, haben wir ein kurzes Briefing-Formular für Sie vorbereitet — dort tragen Sie alles rund um Ihr Angebot, Ihre Zielgruppe und Ihr Unternehmen ein. Dauert etwa 10 Minuten.`)
    : t(k, `wir freuen uns auf eure Recruiting-Kampagne! Damit wir starten können, haben wir ein kurzes Briefing-Formular für euch vorbereitet — dort tragt ihr alles rund um eure offene Stelle, eure Benefits und euer Unternehmen ein. Dauert etwa 10 Minuten.`,
            `wir freuen uns auf Ihre Recruiting-Kampagne! Damit wir starten können, haben wir ein kurzes Briefing-Formular für Sie vorbereitet — dort tragen Sie alles rund um Ihre offene Stelle, Ihre Benefits und Ihr Unternehmen ein. Dauert etwa 10 Minuten.`);
  const intro = (customText || '').trim() || defaultIntro;

  const bullets = isNeukunden
    ? [
        t(k, 'Euer Produkt oder eure Dienstleistung', 'Ihr Produkt oder Ihre Dienstleistung'),
        t(k, 'Eure Zielgruppe und was ihr besonders gut könnt', 'Ihre Zielgruppe und was Sie besonders gut können'),
        t(k, 'Logo + ein paar Produkt- oder Referenzbilder', 'Logo + ein paar Produkt- oder Referenzbilder'),
      ]
    : [
        t(k, 'Eure offene Stelle und was sie besonders macht', 'Ihre offene Stelle und was sie besonders macht'),
        'Benefits und Arbeitsumfeld',
        t(k, 'Logo + ein paar Fotos von euch', 'Logo + ein paar Fotos von Ihnen'),
      ];
  const tipp = isNeukunden
    ? t(k, `<strong>Tipp:</strong> Falls ihr eine bestehende Landingpage oder ein Angebots-PDF habt, könnt ihr die URL oder Datei oben im Formular einfügen — wir lesen sie automatisch aus, ihr passt nur noch an.`,
          `<strong>Tipp:</strong> Falls Sie eine bestehende Landingpage oder ein Angebots-PDF haben, können Sie die URL oder Datei oben im Formular einfügen — wir lesen sie automatisch aus, Sie passen nur noch an.`)
    : t(k, `<strong>Tipp:</strong> Falls ihr eine bestehende Stellenanzeige als URL oder PDF habt, könnt ihr sie oben im Formular einfügen — wir lesen sie automatisch aus, ihr passt nur noch an.`,
          `<strong>Tipp:</strong> Falls Sie eine bestehende Stellenanzeige als URL oder PDF haben, können Sie sie oben im Formular einfügen — wir lesen sie automatisch aus, Sie passen nur noch an.`);
  const subject = isNeukunden
    ? t(k, 'Kurzes Briefing-Formular für eure Neukunden-Kampagne', 'Kurzes Briefing-Formular für Ihre Neukunden-Kampagne')
    : t(k, 'Kurzes Briefing-Formular für eure Recruiting-Kampagne', 'Kurzes Briefing-Formular für Ihre Recruiting-Kampagne');

  const content = `
    <tr><td style="padding:28px 32px 8px;">
      <p style="font-size:15px;line-height:1.55;color:#0a0a0a;margin:0 0 14px;">${escape(grusszeile)},</p>
      <p style="font-size:15px;line-height:1.6;color:#2a2a2a;margin:0 0 18px;">${escape(intro).replace(/\n/g, '<br>')}</p>
      <p style="font-size:14px;line-height:1.6;color:#2a2a2a;margin:0 0 18px;">Im Formular fragen wir ab:</p>
      <ul style="font-size:14px;line-height:1.7;color:#2a2a2a;margin:0 0 22px;padding-left:18px;">
        ${bullets.map(b => `<li>${escape(b)}</li>`).join('')}
      </ul>
      <p style="font-size:14px;line-height:1.6;color:#2a2a2a;margin:0 0 22px;">
        ${tipp}
      </p>
    </td></tr>
    <tr><td align="center" style="padding:0 32px 28px;">
      <a href="${escape(formularUrl)}" style="display:inline-block;background:${brand.accent};color:${brand.accentInk};text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:100px;letter-spacing:0.02em;">→ Formular ausfüllen</a>
      <p style="font-size:11px;color:#9a9994;margin:14px 0 0;">Der Link ist persönlich für euch.</p>
    </td></tr>
    <tr><td style="padding:0 32px 24px;">
      <p style="font-size:13px;line-height:1.6;color:#5a5955;margin:0;">Fragen? Einfach auf diese Mail antworten.</p>
      <p style="font-size:13px;line-height:1.6;color:#0a0a0a;margin:14px 0 0;font-weight:600;">Euer ${escape(brand.name)}-Team</p>
    </td></tr>`;

  const html = brandedShell({ brand, contentHtml: content });
  const text = `${grusszeile},\n\n${intro}\n\nLink zum Formular: ${formularUrl}\n\nVielen Dank!\n${t(k, 'Euer', 'Ihr')} ${brand.name}-Team`;

  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: getMailFrom(brand),
      to,
      bcc: getInternalBcc([], [to].flat()),
      reply_to: getMailReplyTo(brand),
      subject,
      html, text,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend ${response.status}: ${body.slice(0, 300)}`);
  }
  return await response.json();
}

/* ═════════════ Interne Mitarbeiter-Benachrichtigungen ═════════════ */

// Empfänger-Liste aus Env (Komma-getrennt). Fallback: info@nowagwirth.de.
export function getNotificationRecipients() {
  const raw = process.env.NOTIFICATION_EMAILS || 'info@nowagwirth.de';
  return raw.split(',')
    .map(s => s.trim())
    .filter(s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
}

async function sendInternalNotification({ subject, html, text }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[mail] RESEND_API_KEY nicht gesetzt — interne Benachrichtigung übersprungen.');
    return null;
  }
  const recipients = getNotificationRecipients();
  if (recipients.length === 0) {
    console.warn('[mail] Keine gültigen NOTIFICATION_EMAILS — übersprungen.');
    return null;
  }
  try {
    const response = await fetch(RESEND_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: INTERNAL_FROM,
        to: recipients,
        subject,
        html,
        text,
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      console.warn(`[mail] interne Benachrichtigung ${response.status}: ${body.slice(0, 200)}`);
    }
    return response.ok;
  } catch (err) {
    console.warn('[mail] interne Benachrichtigung Fehler:', err.message);
    return false;
  }
}

/* ── Warnung: Bewerbung ohne eindeutige Stellenzuordnung (Multi-Stellen-Funnel) ── */
export async function sendBewerbungUnzugeordnetWarnung({ kunde, job, antwortText, alleAntworten }) {
  const insideBase = process.env.INSIDE_BASE_URL || 'https://inside.talent-one.de';
  const jobUrl = job ? `${insideBase}/kunden/${kunde?.id}/jobs/${job.id}/bewerbungen` : insideBase;
  const antwortenHtml = (alleAntworten || [])
    .map(a => `<li><strong>${escape(a.frage_text || '')}:</strong> ${escape(String(a.antwort || ''))}</li>`).join('');
  const html = `
    <div style="font-family:-apple-system,Arial,sans-serif;color:#0a0a0a;max-width:600px;">
      <h2 style="margin:0 0 8px;">⚠️ Bewerbung konnte keiner Stelle zugeordnet werden</h2>
      <p style="font-size:14px;line-height:1.6;">Kunde: <strong>${escape(kunde?.firmenname || '—')}</strong></p>
      <p style="font-size:14px;line-height:1.6;">Stellenauswahl-Antwort: <strong>${escape(antwortText || '(keine erkannt)')}</strong></p>
      <p style="font-size:14px;line-height:1.6;">Die Bewerbung wurde vorläufig dem Job „${escape(job?.stelle || '—')}" zugeordnet und ist als <em>Zuordnung unklar</em> markiert. Bitte in der Bewerberliste der richtigen Stelle zuordnen.</p>
      <p><a href="${jobUrl}">→ Zur Bewerberliste</a></p>
      ${antwortenHtml ? `<p style="font-size:13px;color:#5a5955;margin-top:16px;">Alle Antworten:</p><ul style="font-size:13px;color:#5a5955;">${antwortenHtml}</ul>` : ''}
    </div>`;
  const text = `⚠️ Bewerbung konnte keiner Stelle zugeordnet werden.\nKunde: ${kunde?.firmenname || '—'}\nStellenauswahl-Antwort: ${antwortText || '(keine erkannt)'}\nVorläufig zugeordnet zu: ${job?.stelle || '—'} (Zuordnung unklar).\n${jobUrl}`;
  return sendInternalNotification({
    subject: `⚠️ Bewerbung ohne Stellenzuordnung — ${kunde?.firmenname || 'Kunde'}`,
    html, text,
  });
}

/* ── Formular ausgefüllt — interne Mail mit allen Daten ── */

export async function sendFormularEingang({ kunde, job, formdata, kundeUrl }) {
  const brand = getBranding(kunde?.agentur);
  const kundenname = kunde?.firmenname || 'Neuer Kunde';
  const stelle = job?.stelle || 'Stelle';

  const benefits = Array.isArray(job?.benefits) ? job.benefits.filter(Boolean) : [];

  const kundenZeilen = [
    ['Firmenname',     kunde?.firmenname],
    ['Ansprechpartner', kunde?.ansprechpartner],
    ['E-Mail',         kunde?.email],
    ['Telefon',        kunde?.telefon],
    ['Website',        kunde?.website_url],
    ['Branche',        kunde?.branche],
  ].filter(([, v]) => (v ?? '').toString().trim());

  const jobZeilen = [
    ['Stelle',            job?.stelle],
    ['Region',            job?.region],
    ['Gehalt',            job?.gehalt],
    ['Reisebereitschaft', job?.reisebereitschaft ? 'Ja' : null],
    ['Quereinsteiger',    job?.quereinsteiger ? 'Ja' : null],
    ['Besonderheiten',    job?.besonderheiten],
  ].filter(([, v]) => (v ?? '').toString().trim());

  const fd = formdata || {};
  const formdataLabels = {
    mitarbeiter_anzahl:        'Mitarbeiterzahl',
    unterschied:               'Was unterscheidet das Unternehmen',
    mitarbeiter_gerne:         'Warum arbeiten Mitarbeiter gerne hier',
    unternehmenskultur:        'Unternehmenskultur',
    ausbildung:                'Passende Ausbildung',
    kandidat_eigenschaften:    'Eigenschaften idealer Kandidat',
  };
  const formdataZeilen = Object.entries(formdataLabels)
    .map(([k, label]) => [label, fd[k]])
    .filter(([, v]) => (v ?? '').toString().trim());

  function tableHtml(rows) {
    return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
${rows.map(([k, v]) => `
  <tr>
    <td style="padding:8px 0;border-bottom:1px solid #ececea;font-size:12px;color:#5a5955;width:38%;vertical-align:top;">${escape(k)}</td>
    <td style="padding:8px 0;border-bottom:1px solid #ececea;font-size:13px;color:#0a0a0a;font-weight:500;">${escape(String(v))}</td>
  </tr>`).join('')}
</table>`;
  }

  const benefitsHtml = benefits.length === 0 ? '' :
    `<h3 style="font-size:13px;color:#0a0a0a;margin:18px 0 6px;font-weight:700;">Benefits</h3>
     <p style="font-size:13px;color:#0a0a0a;margin:0;line-height:1.6;">${escape(benefits.join(' · '))}</p>`;

  const html = `<!doctype html>
<html lang="de"><body style="margin:0;padding:0;background:#f0efed;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#0a0a0a;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0efed;padding:32px 0;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;max-width:600px;width:100%;">
  <tr><td style="background:${brand.primary};padding:18px 28px;">${brand.logoHtml}</td></tr>
  <tr><td style="padding:24px 28px 8px;">
    <p style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9a9994;margin:0 0 8px;">Neues Projekt · ${escape(brand.name)}</p>
    <h1 style="font-size:22px;font-weight:700;letter-spacing:-0.02em;margin:0 0 4px;color:#0a0a0a;">${escape(kundenname)}</h1>
    <p style="font-size:13px;color:#5a5955;margin:0 0 6px;">hat das Briefing-Formular ausgefüllt für <strong>${escape(stelle)}</strong></p>
  </td></tr>
  <tr><td style="padding:14px 28px 4px;">
    <h2 style="font-size:14px;font-weight:700;color:#0a0a0a;margin:14px 0 8px;">Kunde</h2>
    ${tableHtml(kundenZeilen)}
    <h2 style="font-size:14px;font-weight:700;color:#0a0a0a;margin:22px 0 8px;">Stelle</h2>
    ${tableHtml(jobZeilen)}
    ${benefitsHtml}
    ${formdataZeilen.length === 0 ? '' : `
      <h2 style="font-size:14px;font-weight:700;color:#0a0a0a;margin:22px 0 8px;">Unternehmens-Briefing</h2>
      ${tableHtml(formdataZeilen)}
    `}
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;">
      <tr><td align="center">
        <a href="${escape(kundeUrl)}" style="display:inline-block;background:${brand.accent};color:${brand.accentInk};text-decoration:none;font-weight:700;font-size:14px;padding:12px 26px;border-radius:100px;">→ Projekt im Inside-Tool öffnen</a>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:18px 28px;background:#fafaf8;border-top:1px solid #ececea;text-align:center;">
    <p style="font-size:11px;color:#9a9994;margin:0;">Inside · interne Benachrichtigung</p>
  </td></tr>
</table></td></tr></table></body></html>`;

  const textLines = [
    `${kundenname} hat das Briefing-Formular ausgefüllt — Stelle: ${stelle}.`,
    '',
    'Kunde:',
    ...kundenZeilen.map(([k, v]) => `  ${k}: ${v}`),
    '',
    'Stelle:',
    ...jobZeilen.map(([k, v]) => `  ${k}: ${v}`),
  ];
  if (benefits.length) textLines.push('', `Benefits: ${benefits.join(', ')}`);
  if (formdataZeilen.length) {
    textLines.push('', 'Unternehmens-Briefing:');
    for (const [k, v] of formdataZeilen) textLines.push(`  ${k}: ${v}`);
  }
  textLines.push('', `Link: ${kundeUrl}`);

  return sendInternalNotification({
    subject: `Neues Projekt: ${kundenname} hat Formular ausgefüllt`,
    html,
    text: textLines.join('\n'),
  });
}

/* ── Kunde gibt Entwürfe frei oder schickt Änderungswünsche ── */

const STIL_LABEL = { emotional: 'Emotional', benefit: 'Benefits', kompakt: 'Knackig' };
const FORMAT_LABEL = { quadrat: '1:1', story: '9:16' };

export async function sendReviewBenachrichtigung({ kunde, job, status, kommentare, jobUrl, creatives = [], adcopies = [], snapshot = {} }) {
  const brand = getBranding(kunde?.agentur);
  const kundenname = kunde?.firmenname || 'Ein Kunde';
  const stelle = job?.stelle || 'Stelle';
  const isFreigegeben = status === 'freigegeben';

  const creativesById = new Map(creatives.map(c => [c.id, c]));
  const adcopiesById  = new Map(adcopies.map(a => [a.id, a]));

  // Kommentare als Liste (kommentare ist ein Object: { creative_<id>: "...", adcopy_<id>: "..." })
  const kommentarRows = kommentare && typeof kommentare === 'object'
    ? Object.entries(kommentare).filter(([, v]) => (v || '').trim())
    : [];

  function renderKey(k) {
    if (k.startsWith('creative_')) {
      const id = k.slice('creative_'.length);
      // Snapshot zuerst, dann Live-DB
      const snap = snapshot?.[k];
      const c = (snap && snap.bild_url) ? snap : creativesById.get(id);
      if (c?.bild_url) {
        const fmt = FORMAT_LABEL[c.format] || c.format || '';
        const typ = c.typ === 'video' ? 'Video' : 'Bild';
        return `
          <div style="display:flex;align-items:flex-start;gap:10px;">
            <img src="${escape(c.bild_url)}" alt="Creative" width="120" style="display:block;width:120px;height:auto;border-radius:8px;border:1px solid #ececea;" />
            <div style="font-size:12px;color:#5a5955;line-height:1.4;">
              <span style="display:inline-block;padding:2px 8px;background:#0a0a0a;color:#fff;border-radius:100px;font-weight:700;font-size:10px;letter-spacing:0.04em;">${escape(fmt || '—')}</span>
              <div style="margin-top:4px;color:#9a9994;font-size:10.5px;">${escape(typ)} · ${escape(id.slice(0, 8))}…</div>
            </div>
          </div>`;
      }
      return `<div><strong>Creative</strong> <span style="color:#9a9994;font-size:11px;">${escape(id.slice(0, 8))}…</span></div><div style="font-size:11px;color:#b91c1c;margin-top:4px;">⚠ Original-Bild nicht mehr verfügbar (Creative wurde regeneriert)</div>`;
    }
    if (k.startsWith('adcopy_')) {
      const id = k.slice('adcopy_'.length);
      const snap = snapshot?.[k];
      const stil = snap?.stil || adcopiesById.get(id)?.stil;
      const stilLabel = stil ? (STIL_LABEL[stil] || stil) : 'Ad-Copy';
      return `<div style="font-size:13px;font-weight:700;color:#0a0a0a;">${escape(stilLabel)}</div><div style="font-size:10.5px;color:#9a9994;margin-top:2px;">${escape(id.slice(0, 8))}…</div>`;
    }
    if (k === 'funnel')    return '<strong>Funnel</strong>';
    if (k === 'allgemein') return '<strong>Allgemein</strong>';
    return `<strong>${escape(k)}</strong>`;
  }

  function labelForText(k) {
    if (k.startsWith('creative_')) {
      const c = creativesById.get(k.slice('creative_'.length));
      return `Creative ${FORMAT_LABEL[c?.format] || ''}`.trim();
    }
    if (k.startsWith('adcopy_')) {
      const a = adcopiesById.get(k.slice('adcopy_'.length));
      return `Ad-Copy ${STIL_LABEL[a?.stil] || ''}`.trim();
    }
    if (k === 'funnel') return 'Funnel';
    if (k === 'allgemein') return 'Allgemein';
    return k;
  }

  const kommentareHtml = kommentarRows.length === 0 ? '' : `
    <h2 style="font-size:14px;font-weight:700;color:#0a0a0a;margin:22px 0 10px;">Kommentare des Kunden</h2>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
    ${kommentarRows.map(([k, v]) => `
      <tr>
        <td style="padding:14px 12px 14px 0;border-bottom:1px solid #ececea;width:40%;vertical-align:top;">${renderKey(k)}</td>
        <td style="padding:14px 0;border-bottom:1px solid #ececea;font-size:13px;color:#0a0a0a;font-weight:500;white-space:pre-wrap;vertical-align:top;">${escape(String(v))}</td>
      </tr>`).join('')}
    </table>`;

  const headline = isFreigegeben ? 'Entwürfe freigegeben' : 'Änderungswünsche';
  const lead = isFreigegeben
    ? `${kundenname} hat die Entwürfe für <strong>${escape(stelle)}</strong> freigegeben — alles bereit zum Schalten.`
    : `${kundenname} hat Änderungswünsche zu den Entwürfen für <strong>${escape(stelle)}</strong>.`;
  const subjectEmoji = isFreigegeben ? '✅' : '📝';
  const subjectSuffix = isFreigegeben ? 'hat Entwürfe freigegeben' : 'hat Änderungswünsche';

  const html = `<!doctype html>
<html lang="de"><body style="margin:0;padding:0;background:#f0efed;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#0a0a0a;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0efed;padding:32px 0;"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;max-width:560px;width:100%;">
  <tr><td style="background:${brand.primary};padding:18px 28px;">${brand.logoHtml}</td></tr>
  <tr><td style="padding:24px 28px 8px;">
    <p style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9a9994;margin:0 0 8px;">${subjectEmoji} Review · ${escape(brand.name)}</p>
    <h1 style="font-size:22px;font-weight:700;letter-spacing:-0.02em;margin:0 0 6px;color:#0a0a0a;">${escape(headline)}</h1>
    <p style="font-size:14px;color:#2a2a2a;margin:0;line-height:1.55;">${lead}</p>
    ${kommentareHtml}
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;">
      <tr><td align="center">
        <a href="${escape(jobUrl)}" style="display:inline-block;background:${brand.accent};color:${brand.accentInk};text-decoration:none;font-weight:700;font-size:14px;padding:12px 26px;border-radius:100px;">→ Projekt im Inside-Tool öffnen</a>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:18px 28px;background:#fafaf8;border-top:1px solid #ececea;text-align:center;">
    <p style="font-size:11px;color:#9a9994;margin:0;">Inside · interne Benachrichtigung</p>
  </td></tr>
</table></td></tr></table></body></html>`;

  const textLines = [
    `${kundenname} — ${headline} (${stelle})`,
    '',
    isFreigegeben ? 'Status: Freigegeben — bereit zum Schalten.' : 'Status: Änderungswünsche',
  ];
  if (kommentarRows.length) {
    textLines.push('', 'Kommentare:');
    for (const [k, v] of kommentarRows) {
      textLines.push(`\n${labelForText(k)}:`, v);
    }
  }
  textLines.push('', `Link zum Projekt: ${jobUrl}`);

  return sendInternalNotification({
    subject: `${subjectEmoji} ${kundenname} ${subjectSuffix}`,
    html,
    text: textLines.join('\n'),
  });
}

/* ════════════════════ PayPal-Zahlungslink an Kunden ════════════════════ */

function formatEur(cent) {
  const v = (cent / 100).toFixed(2).replace('.', ',');
  return v.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' €';
}

export async function sendZahlungsMail({ to, kunde, job, zahlung }) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY nicht gesetzt.');
  }
  const brand = getBranding(kunde?.agentur);
  const recipients = Array.isArray(to) ? to : [to];
  const betragStr = formatEur(zahlung.betrag_cent);
  const stelle = job?.stelle || 'Projekt';
  const firma = kunde?.firmenname || 'euer Team';

  const content = `
    <tr><td style="padding:28px 32px 8px;">
      <p style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9a9994;margin:0 0 8px;">Rechnung · ${escape(brand.name)}</p>
      <h1 style="font-size:24px;font-weight:700;letter-spacing:-0.02em;margin:0 0 6px;color:#0a0a0a;">${escape(betragStr)}</h1>
      <p style="font-size:14px;color:#5a5955;margin:0 0 18px;">Werbebudget für <strong>${escape(stelle)}</strong></p>

      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:6px 0 18px;">
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #ececea;font-size:12px;color:#5a5955;width:40%;">Beschreibung</td>
          <td style="padding:8px 0;border-bottom:1px solid #ececea;font-size:13px;color:#0a0a0a;">${escape(zahlung.beschreibung || '—')}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #ececea;font-size:12px;color:#5a5955;">Betrag</td>
          <td style="padding:8px 0;border-bottom:1px solid #ececea;font-size:13px;color:#0a0a0a;font-weight:600;">${escape(betragStr)}</td>
        </tr>
        ${zahlung.faelligkeit ? `
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #ececea;font-size:12px;color:#5a5955;">Fälligkeit</td>
          <td style="padding:8px 0;border-bottom:1px solid #ececea;font-size:13px;color:#0a0a0a;">${escape(new Date(zahlung.faelligkeit).toLocaleDateString('de-DE'))}</td>
        </tr>` : ''}
        ${zahlung.paypal_invoice_number ? `
        <tr>
          <td style="padding:8px 0;font-size:12px;color:#5a5955;">Rechnungs-Nr.</td>
          <td style="padding:8px 0;font-size:13px;color:#0a0a0a;">${escape(zahlung.paypal_invoice_number)}</td>
        </tr>` : ''}
      </table>
    </td></tr>
    <tr><td align="center" style="padding:0 32px 28px;">
      <a href="${escape(zahlung.pay_link)}" style="display:inline-block;background:${brand.accent};color:${brand.accentInk};text-decoration:none;font-weight:700;font-size:16px;padding:16px 32px;border-radius:100px;letter-spacing:0.02em;">→ Jetzt bezahlen mit PayPal</a>
      <p style="font-size:11px;color:#9a9994;margin:14px 0 0;">Sichere Zahlung über PayPal — Konto nicht zwingend nötig (auch Kreditkarte möglich).</p>
    </td></tr>
    <tr><td style="padding:0 32px 24px;">
      <p style="font-size:13px;line-height:1.6;color:#5a5955;margin:0;">Bei Fragen einfach auf diese Mail antworten.</p>
      <p style="font-size:13px;line-height:1.6;color:#0a0a0a;margin:14px 0 0;font-weight:600;">${t(kunde, 'Euer', 'Ihr')} ${escape(brand.name)}-Team</p>
    </td></tr>`;

  const html = brandedShell({ brand, contentHtml: content });
  const text = `Rechnung für ${stelle}\n\nBetrag: ${betragStr}\nBeschreibung: ${zahlung.beschreibung || ''}\n${zahlung.faelligkeit ? `Fällig: ${new Date(zahlung.faelligkeit).toLocaleDateString('de-DE')}\n` : ''}\nJetzt bezahlen: ${zahlung.pay_link}\n\nViele Grüße\n${t(kunde, 'Euer', 'Ihr')} ${brand.name}-Team`;

  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: getMailFrom(brand),
      to: recipients,
      bcc: getInternalBcc([], recipients),
      reply_to: getMailReplyTo(brand),
      subject: `Rechnung Werbebudget — ${stelle}`,
      html, text,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend ${response.status}: ${body.slice(0, 300)}`);
  }
  return await response.json();
}

/* ════════════════════ Neukunden-Anfrage an Kunden ════════════════════
   Kommt via Webhook-Endpoint /api/webhooks/leads rein. Kompaktes „🎉 Neue
   Anfrage"-Layout mit Link zum Public-Anfragen-Dashboard. Branding je
   Agentur, BCC ans interne Team. */
export async function sendAnfrageMail({ to, kunde, job, anfrage, anfragenUrl }) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY nicht gesetzt.');
  const brand = getBranding(kunde?.agentur);
  const recipients = Array.isArray(to) ? to : [to];
  const produkt = job?.stelle || (job?.neukunden_daten?.produkt) || 'Produkt';
  const daten = anfrage?.daten || {};
  const datenRows = Object.entries(daten)
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(([k, v]) => `<tr>
      <td style="padding:6px 0;border-bottom:1px solid #ececea;font-size:12px;color:#5a5955;width:35%;">${escape(k)}</td>
      <td style="padding:6px 0;border-bottom:1px solid #ececea;font-size:13px;color:#0a0a0a;">${escape(String(v).slice(0, 300))}</td>
    </tr>`).join('');

  const content = `
    <tr><td style="padding:28px 32px 8px;">
      <p style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9a9994;margin:0 0 8px;">🎉 Neue Anfrage · ${escape(brand.name)}</p>
      <h1 style="font-size:22px;font-weight:700;letter-spacing:-0.02em;margin:0 0 6px;color:#0a0a0a;">${escape(anfrage?.name || 'Neue Kundenanfrage')}</h1>
      <p style="font-size:14px;color:#5a5955;margin:0 0 18px;">Interesse an <strong>${escape(produkt)}</strong></p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:6px 0 18px;">
        ${anfrage?.email   ? `<tr><td style="padding:6px 0;border-bottom:1px solid #ececea;font-size:12px;color:#5a5955;width:35%;">E-Mail</td><td style="padding:6px 0;border-bottom:1px solid #ececea;font-size:13px;color:#0a0a0a;"><a href="mailto:${escape(anfrage.email)}" style="color:#0a0a0a;">${escape(anfrage.email)}</a></td></tr>` : ''}
        ${anfrage?.telefon ? `<tr><td style="padding:6px 0;border-bottom:1px solid #ececea;font-size:12px;color:#5a5955;">Telefon</td><td style="padding:6px 0;border-bottom:1px solid #ececea;font-size:13px;color:#0a0a0a;"><a href="tel:${escape(anfrage.telefon)}" style="color:#0a0a0a;">${escape(anfrage.telefon)}</a></td></tr>` : ''}
        ${datenRows}
      </table>
    </td></tr>
    ${anfragenUrl ? `<tr><td align="center" style="padding:0 32px 28px;">
      <a href="${escape(anfragenUrl)}" style="display:inline-block;background:${brand.accent};color:${brand.accentInk};text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:100px;">→ Alle Anfragen ansehen</a>
    </td></tr>` : ''}
    <tr><td style="padding:0 32px 24px;">
      <p style="font-size:13px;line-height:1.6;color:#5a5955;margin:0;">${t(kunde, 'Melde dich zeitnah', 'Melden Sie sich zeitnah')} — je schneller die Kontaktaufnahme, desto höher die Abschluss-Wahrscheinlichkeit.</p>
      <p style="font-size:13px;line-height:1.6;color:#0a0a0a;margin:14px 0 0;font-weight:600;">Viel Erfolg!<br>${t(kunde, 'Euer', 'Ihr')} ${escape(brand.name)}-Team</p>
    </td></tr>`;

  const html = brandedShell({ brand, contentHtml: content });
  const textLines = [
    `Neue Anfrage für ${produkt}`, '',
    anfrage?.name    ? `Name:    ${anfrage.name}`    : null,
    anfrage?.email   ? `E-Mail:  ${anfrage.email}`   : null,
    anfrage?.telefon ? `Telefon: ${anfrage.telefon}` : null,
    ...Object.entries(daten).map(([k, v]) => `${k}: ${String(v).slice(0, 200)}`),
    anfragenUrl ? `\nAlle Anfragen: ${anfragenUrl}` : null,
  ].filter(Boolean);

  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: getMailFrom(brand),
      to: recipients,
      bcc: getInternalBcc([], recipients),
      reply_to: getMailReplyTo(brand),
      subject: `🎉 Neue Anfrage für ${produkt}: ${anfrage?.name || anfrage?.email || 'Interessent'}`,
      html, text: textLines.join('\n'),
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend ${response.status}: ${body.slice(0, 300)}`);
  }
  return await response.json();
}

/* ════════════════════ @-Mention im Projekt-Kommentar ════════════════════ */

export async function sendMentionMail({ to, mentionedName, autor, projektName, kommentar, projektUrl }) {
  if (!process.env.RESEND_API_KEY) return null;
  const brand = getBranding('nowagwirth');

  const content = `
    <tr><td style="padding:28px 32px 8px;">
      <p style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9a9994;margin:0 0 8px;">📣 Du wurdest erwähnt</p>
      <h1 style="font-size:22px;font-weight:700;letter-spacing:-0.02em;margin:0 0 6px;color:#0a0a0a;">${escape(autor)} hat dich in <span style="color:${brand.accent};">${escape(projektName)}</span> erwähnt</h1>
      <p style="font-size:14px;color:#5a5955;margin:0 0 18px;">Hallo ${escape(mentionedName)}, hier ist der Kommentar:</p>

      <div style="padding:14px 16px;background:#fafaf8;border-left:3px solid ${brand.accent};border-radius:6px;margin:0 0 18px;">
        <p style="font-size:14px;color:#0a0a0a;margin:0;line-height:1.55;white-space:pre-wrap;">${escape(kommentar)}</p>
      </div>
    </td></tr>
    <tr><td align="center" style="padding:0 32px 28px;">
      <a href="${escape(projektUrl)}" style="display:inline-block;background:${brand.accent};color:${brand.accentInk};text-decoration:none;font-weight:700;font-size:14px;padding:12px 26px;border-radius:100px;">→ Direkt zum Projekt</a>
    </td></tr>`;

  const html = brandedShell({ brand, contentHtml: content });
  const text = `${autor} hat dich in "${projektName}" erwähnt:\n\n${kommentar}\n\nLink: ${projektUrl}`;

  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: getMailFrom(brand),
      to: [to],
      reply_to: getMailReplyTo(brand),
      subject: `${autor} hat dich in ${projektName} erwähnt`,
      html, text,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    console.warn(`[mention-mail] Resend ${response.status}: ${body.slice(0,200)}`);
    return null;
  }
  return await response.json();
}

/* ════════════════════ Rechnung als PDF an Kunden ════════════════════ */

export async function sendRechnungsMail({ to, kunde, zahlung, pdfBuffer, pdfFilename }) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY nicht gesetzt.');
  const brand = getBranding(kunde?.agentur);
  const recipients = Array.isArray(to) ? to : [to];
  const rechnungsNr = zahlung.easybill_invoice_number || zahlung.paypal_invoice_number || '—';
  const firma = kunde?.firmenname || 'euer Team';

  const content = `
    <tr><td style="padding:28px 32px 8px;">
      <p style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9a9994;margin:0 0 8px;">Rechnung · ${escape(brand.name)}</p>
      <h1 style="font-size:22px;font-weight:700;letter-spacing:-0.02em;margin:0 0 8px;color:#0a0a0a;">${escape(String(rechnungsNr))}</h1>
      <p style="font-size:14px;color:#5a5955;margin:0 0 18px;">${t(kunde, 'Vielen Dank für eure Zahlung! Anbei erhaltet ihr eure Rechnung als PDF im Anhang.', 'Vielen Dank für Ihre Zahlung! Anbei erhalten Sie Ihre Rechnung als PDF im Anhang.')}</p>
      <p style="font-size:13px;line-height:1.6;color:#5a5955;margin:0 0 6px;">${escape(zahlung.beschreibung || '')}</p>
    </td></tr>
    <tr><td style="padding:0 32px 24px;">
      <p style="font-size:13px;line-height:1.6;color:#5a5955;margin:14px 0 0;">Bei Fragen einfach auf diese Mail antworten.</p>
      <p style="font-size:13px;line-height:1.6;color:#0a0a0a;margin:14px 0 0;font-weight:600;">${t(kunde, 'Euer', 'Ihr')} ${escape(brand.name)}-Team</p>
    </td></tr>`;

  const html = brandedShell({ brand, contentHtml: content });
  const text = `Rechnung ${rechnungsNr}\n\n${zahlung.beschreibung || ''}\n\n${t(kunde, 'Die Rechnung findet ihr im Anhang.', 'Die Rechnung finden Sie im Anhang.')}\n\nViele Grüße\n${t(kunde, 'Euer', 'Ihr')} ${brand.name}-Team`;

  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: getMailFrom(brand),
      to: recipients,
      bcc: getInternalBcc([], recipients),
      reply_to: getMailReplyTo(brand),
      subject: `Rechnung ${rechnungsNr} — ${firma}`,
      html, text,
      attachments: pdfBuffer ? [{
        filename: pdfFilename || 'rechnung.pdf',
        content: Buffer.isBuffer(pdfBuffer) ? pdfBuffer.toString('base64') : pdfBuffer,
      }] : [],
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend ${response.status}: ${body.slice(0, 300)}`);
  }
  return await response.json();
}

/* ════════════════════ Reaktivierungs-Mail mit eingebetteten Creatives ════════════════════ */

export async function sendReaktivierungsMail({ to, replyTo, kunde, job, ansprechpartner, customText, creatives = [], calLink }) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY nicht gesetzt.');
  const brand = getBranding(kunde?.agentur);
  const recipients = Array.isArray(to) ? to : [to];
  const k = kunde || { ansprechpartner };
  const stelle = job?.stelle || 'eure offene Stelle';

  // Standard-Text falls Mitarbeiter nichts eintippt
  const introText = (customText || '').trim() || `${anrede(k)},

wir haben spannende Neuigkeiten: Mit unserer neuen KI-Technologie haben wir frische Werbeanzeigen für ${t(k, 'deine', 'Ihre')} offene Stelle als ${stelle} erstellt — und das Ergebnis kann sich sehen lassen!

Unser Vorschlag: Geh nochmal für 30 Tage online — du zahlst nur die Betreuungspauschale, die Erstellung der neuen Creatives ist inklusive.

${t(k, 'Sollen wir kurz telefonieren? Antworte einfach auf diese Mail oder buch dir direkt einen Termin (unverbindlich):', 'Sollen wir kurz telefonieren? Antworten Sie einfach auf diese Mail oder buchen Sie sich direkt einen Termin (unverbindlich):')} ${calLink || brand.calReaktivierungUrl || brand.calBeratungsUrl}`;

  // Nur Bilder (keine Videos) für Image-Embed, max. 6 Stück
  const bildCreatives = (creatives || []).filter(c => c.typ !== 'video' && c.bild_url).slice(0, 6);

  const creativesHtml = bildCreatives.length === 0 ? '' : `
    <tr><td style="padding:14px 32px 8px;">
      <h2 style="font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5a5955;margin:12px 0 14px;">Neue Werbeanzeigen</h2>
      <table width="100%" cellpadding="0" cellspacing="8" style="border-collapse:separate;">
        ${bildCreatives.map((c, i) => i % 2 === 0 ? `<tr>
          <td width="50%" valign="top" style="padding:6px;">
            <img src="${escape(c.bild_url)}" alt="Creative" width="240" style="display:block;width:100%;max-width:240px;height:auto;border-radius:10px;border:1px solid #ececea;" />
          </td>
          ${bildCreatives[i+1] ? `<td width="50%" valign="top" style="padding:6px;">
            <img src="${escape(bildCreatives[i+1].bild_url)}" alt="Creative" width="240" style="display:block;width:100%;max-width:240px;height:auto;border-radius:10px;border:1px solid #ececea;" />
          </td>` : '<td width="50%"></td>'}
        </tr>` : '').join('')}
      </table>
    </td></tr>`;

  const calUrl = calLink || brand.calReaktivierungUrl || brand.calBeratungsUrl;

  // Render plain-text als HTML mit <p>-Absätzen — Cal-Link wird als Button am Ende separat
  const introHtml = introText
    .split(/\n\s*\n/)
    .map(para => `<p style="font-size:14.5px;line-height:1.65;color:#2a2a2a;margin:0 0 14px;">${escape(para).replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#0a0a0a;">$1</a>')}</p>`)
    .join('');

  const content = `
    <tr><td style="padding:28px 32px 8px;">
      <p style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9a9994;margin:0 0 8px;">🔄 Reaktivierung · ${escape(brand.name)}</p>
      ${introHtml}
    </td></tr>
    ${creativesHtml}
    <tr><td align="center" style="padding:18px 32px 28px;">
      <a href="${escape(calUrl)}" style="display:inline-block;background:${brand.accent};color:${brand.accentInk};text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:100px;letter-spacing:0.02em;">→ Termin buchen (unverbindlich)</a>
    </td></tr>
    <tr><td style="padding:0 32px 24px;">
      <p style="font-size:13px;line-height:1.6;color:#0a0a0a;margin:14px 0 0;font-weight:600;">Euer ${escape(brand.name)}-Team</p>
    </td></tr>`;

  const html = brandedShell({ brand, contentHtml: content });
  const text = `${introText}\n\nTermin buchen: ${calUrl}\n\nViele Grüße\nEuer ${brand.name}-Team`;

  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: getMailFrom(brand),
      to: recipients,
      bcc: getInternalBcc([], recipients),
      reply_to: replyTo || getMailReplyTo(brand),
      subject: `Frische KI-Werbeanzeigen für ${stelle} — reaktivieren?`,
      html, text,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend ${response.status}: ${body.slice(0, 300)}`);
  }
  return await response.json();
}

/* ════════════════════ Kampagne-Live-Mail ════════════════════ */

export async function sendKampagneLiveMail({ to, kunde, job, ansprechpartner, customText, bewerbungenUrl }) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY nicht gesetzt.');
  const brand = getBranding(kunde?.agentur);
  const recipients = Array.isArray(to) ? to : [to];
  const k = kunde || { ansprechpartner };
  const stelle = job?.stelle || t(k, 'deine offene Stelle', 'Ihre offene Stelle');

  const introText = (customText || '').trim() || t(k, `${anrede(k)},

gute Neuigkeiten — deine Recruiting-Kampagne für ${stelle} ist ab jetzt online! 🚀

Ab sofort erreichen wir potenzielle Bewerber mit deinen Anzeigen. Die ersten Bewerbungen können in den nächsten Tagen reinkommen — du wirst pro Bewerbung automatisch per Mail benachrichtigt.

Du kannst alle eingehenden Bewerbungen jederzeit unter dem Link unten einsehen, ihren Status pflegen und Notizen ergänzen.`, `${anrede(k)},

gute Neuigkeiten — Ihre Recruiting-Kampagne für ${stelle} ist ab jetzt online! 🚀

Ab sofort erreichen wir potenzielle Bewerber mit Ihren Anzeigen. Die ersten Bewerbungen können in den nächsten Tagen reinkommen — Sie werden pro Bewerbung automatisch per Mail benachrichtigt.

Sie können alle eingehenden Bewerbungen jederzeit unter dem Link unten einsehen, ihren Status pflegen und Notizen ergänzen.`);

  const introHtml = introText
    .split(/\n\s*\n/)
    .map(p => `<p style="font-size:14.5px;line-height:1.65;color:#2a2a2a;margin:0 0 14px;">${escape(p).replace(/\n/g, '<br>')}</p>`)
    .join('');

  const bewerbungenButton = bewerbungenUrl ? `
    <tr><td align="center" style="padding:18px 32px 8px;">
      <a href="${escape(bewerbungenUrl)}" style="display:inline-block;background:${brand.accent};color:${brand.accentInk};text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:100px;letter-spacing:0.02em;">📋 Zur Bewerberliste</a>
      <p style="font-size:11px;color:#9a9994;margin:10px 0 0;">Der Link ist persönlich und für ${escape(kunde?.firmenname || t(k, 'euch', 'Sie'))} gültig.</p>
    </td></tr>` : '';

  const content = `
    <tr><td style="padding:28px 32px 8px;">
      <p style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9a9994;margin:0 0 8px;">🚀 Kampagne ist live · ${escape(brand.name)}</p>
      ${introHtml}
    </td></tr>
    ${bewerbungenButton}
    <tr><td style="padding:14px 32px 24px;">
      <p style="font-size:13px;line-height:1.6;color:#5a5955;margin:14px 0 0;">Bei Fragen einfach auf diese Mail antworten — ${t(k, 'wir sind für dich da.', 'wir sind für Sie da.')}</p>
      <p style="font-size:13px;line-height:1.6;color:#0a0a0a;margin:14px 0 0;font-weight:600;">Viel Erfolg!<br>Euer ${escape(brand.name)}-Team</p>
    </td></tr>`;

  const html = brandedShell({ brand, contentHtml: content });
  const text = `${introText}\n\n${bewerbungenUrl ? `Zur Bewerberliste: ${bewerbungenUrl}\n\n` : ''}Viel Erfolg!\nEuer ${brand.name}-Team`;

  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: getMailFrom(brand),
      to: recipients,
      bcc: getInternalBcc([], recipients),
      reply_to: getMailReplyTo(brand),
      subject: '🚀 Deine Kampagne ist live!',
      html, text,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend ${response.status}: ${body.slice(0, 300)}`);
  }
  return await response.json();
}

/* ════════════════════ Creative-Auftrag: reiche Team-Mail ════════════════════
   Empfaenger: laura.mueller@nowagwirth.de + info@nowagwirth.de.
   Zeigt Kunde, Stelle, Briefing-Zusammenfassung, Fotos-Status, Live-Termin
   und einen Direkt-Link in den Creatives-Tab. Wird sowohl automatisch beim
   Erreichen der Creative-Stufe als auch manuell aus dem Creatives-Tab ausgeloest. */
export async function sendCreativeAuftragMail({ kunde, job, projekt, fotosVorhanden, creativesUrl, manuell = false }) {
  if (!process.env.RESEND_API_KEY) return null;
  const to = ['laura.mueller@nowagwirth.de', 'info@nowagwirth.de'];
  const brand = getBranding(kunde?.agentur || 'nowagwirth');
  const firma = kunde?.firmenname || 'Kunde';
  const stelle = job?.stelle || 'Stelle';
  const fd = job?.formdata_komplett || {};
  const benefits = Array.isArray(job?.benefits) ? job.benefits.filter(Boolean) : [];
  const usp = fd.unterschied || fd.usp || null;
  const besonderheiten = job?.besonderheiten || fd.besonderheiten || null;
  const arbeitshinweise = job?.arbeitshinweise || null;
  const liveTermin = projekt?.live_termin ? new Date(projekt.live_termin).toLocaleDateString('de-DE') : null;

  const briefingRows = [
    benefits.length && `<tr><td style="padding:6px 12px;border-bottom:1px solid #f0efed;font-size:12px;color:#5a5955;width:170px;">Benefits</td><td style="padding:6px 12px;border-bottom:1px solid #f0efed;font-size:13px;color:#0a0a0a;">${escape(benefits.slice(0, 8).join(' · '))}</td></tr>`,
    usp && `<tr><td style="padding:6px 12px;border-bottom:1px solid #f0efed;font-size:12px;color:#5a5955;">USP</td><td style="padding:6px 12px;border-bottom:1px solid #f0efed;font-size:13px;color:#0a0a0a;">${escape(String(usp).slice(0, 300))}</td></tr>`,
    besonderheiten && `<tr><td style="padding:6px 12px;border-bottom:1px solid #f0efed;font-size:12px;color:#5a5955;">Besonderheiten</td><td style="padding:6px 12px;border-bottom:1px solid #f0efed;font-size:13px;color:#0a0a0a;">${escape(String(besonderheiten).slice(0, 300))}</td></tr>`,
    arbeitshinweise && `<tr><td style="padding:6px 12px;border-bottom:1px solid #f0efed;font-size:12px;color:#5a5955;">Arbeitshinweis</td><td style="padding:6px 12px;border-bottom:1px solid #f0efed;font-size:13px;color:#b45309;font-weight:600;">⚠️ ${escape(String(arbeitshinweise).slice(0, 300))}</td></tr>`,
    `<tr><td style="padding:6px 12px;border-bottom:1px solid #f0efed;font-size:12px;color:#5a5955;">Fotos vom Kunden</td><td style="padding:6px 12px;border-bottom:1px solid #f0efed;font-size:13px;color:${fotosVorhanden ? '#166534' : '#b45309'};font-weight:600;">${fotosVorhanden ? '✓ Vorhanden' : '✗ Keine Fotos hochgeladen'}</td></tr>`,
    liveTermin && `<tr><td style="padding:6px 12px;border-bottom:1px solid #f0efed;font-size:12px;color:#5a5955;">Live-Termin</td><td style="padding:6px 12px;border-bottom:1px solid #f0efed;font-size:13px;color:#0a0a0a;">📅 ${escape(liveTermin)}</td></tr>`,
  ].filter(Boolean).join('');

  const content = `
    <tr><td style="padding:28px 32px 8px;">
      <p style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9a9994;margin:0 0 8px;">🎨 Creative-Auftrag${manuell ? ' · manuell' : ''}</p>
      <h1 style="font-size:22px;font-weight:700;letter-spacing:-0.02em;margin:0 0 6px;color:#0a0a0a;">${escape(firma)}</h1>
      <p style="font-size:14px;color:#5a5955;margin:0 0 18px;">Stelle: <strong>${escape(stelle)}</strong></p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #f0efed;border-bottom:1px solid #f0efed;">${briefingRows}</table>
    </td></tr>
    ${creativesUrl ? `<tr><td align="center" style="padding:16px 32px 24px;">
      <a href="${escape(creativesUrl)}" style="display:inline-block;background:${brand.accent};color:${brand.accentInk};text-decoration:none;font-weight:700;font-size:14px;padding:12px 26px;border-radius:100px;">→ Zum Creatives-Tab</a>
    </td></tr>` : ''}`;
  const html = brandedShell({ brand, contentHtml: content });
  const text = [
    `Creative-Auftrag${manuell ? ' (manuell)' : ''}: ${firma}`,
    `Stelle: ${stelle}`,
    ``,
    benefits.length ? `Benefits: ${benefits.slice(0, 8).join(' · ')}` : null,
    usp ? `USP: ${String(usp).slice(0, 300)}` : null,
    besonderheiten ? `Besonderheiten: ${String(besonderheiten).slice(0, 300)}` : null,
    arbeitshinweise ? `Arbeitshinweis: ${String(arbeitshinweise).slice(0, 300)}` : null,
    `Fotos: ${fotosVorhanden ? 'vorhanden' : 'nicht hochgeladen'}`,
    liveTermin ? `Live-Termin: ${liveTermin}` : null,
    creativesUrl ? `\nCreatives-Tab: ${creativesUrl}` : null,
  ].filter(Boolean).join('\n');

  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: INTERNAL_FROM, to,
      subject: `🎨 Creatives können erstellt werden: ${firma} — ${stelle}`,
      html, text,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    console.warn(`[creative-auftrag] Resend ${response.status}: ${body.slice(0, 200)}`);
    return null;
  }
  return await response.json();
}

/* ════════════════════ Team-Alert (intern, keine Kunden-Adresse) ════════════════════
   Kompakte HTML-Mail an das Kreativ-Team — z. B. für den 2-Tage-Reminder
   vorm Go-Live oder für „neuer Kunde, Creatives können erstellt werden".
   Empfänger sind fix: info@nowagwirth.de + laura.mueller@nowagwirth.de. */
export async function sendTeamAlertMail({ subject, headline, lead, linkUrl, linkLabel = 'Zum Projekt' }) {
  if (!process.env.RESEND_API_KEY) return null;
  const to = ['info@nowagwirth.de', 'laura.mueller@nowagwirth.de'];
  const brand = getBranding('nowagwirth');

  const content = `
    <tr><td style="padding:28px 32px 8px;">
      <p style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9a9994;margin:0 0 8px;">📣 Team-Info · Inside</p>
      <h1 style="font-size:22px;font-weight:700;letter-spacing:-0.02em;margin:0 0 6px;color:#0a0a0a;">${escape(headline || '')}</h1>
      <p style="font-size:14px;color:#2a2a2a;margin:0;line-height:1.55;">${escape(lead || '')}</p>
    </td></tr>
    ${linkUrl ? `<tr><td align="center" style="padding:16px 32px 24px;">
      <a href="${escape(linkUrl)}" style="display:inline-block;background:${brand.accent};color:${brand.accentInk};text-decoration:none;font-weight:700;font-size:14px;padding:12px 26px;border-radius:100px;">→ ${escape(linkLabel)}</a>
    </td></tr>` : ''}`;
  const html = brandedShell({ brand, contentHtml: content });
  const text = `${headline}\n\n${lead}${linkUrl ? '\n\n' + linkLabel + ': ' + linkUrl : ''}`;

  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: INTERNAL_FROM,
      to,
      subject: subject || 'Team-Info',
      html, text,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    console.warn(`[team-alert] Resend ${response.status}: ${body.slice(0, 200)}`);
    return null;
  }
  return await response.json();
}

/* ════════════════════ Entwurfs-Reminder — Kunden-Mail ════════════════════
   Kurze Du-Form-Nachfrage wenn der Kunde noch nicht auf die Entwuerfe
   reagiert hat. Enthaelt den Review-Link. Absender + BCC + Reply-To wie
   bei den anderen Kunden-Mails. */
export async function sendEntwurfReminder({ to, kunde, ansprechpartner, reviewUrl, customText, agentur }) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY nicht gesetzt.');
  const brand = getBranding(agentur);
  const k = kunde || { ansprechpartner };
  const gruss = anrede(k);

  const defaultText = t(k,
    `vor ein paar Tagen haben wir dir die Entwürfe für deine Recruiting-Kampagne geschickt. Hast du schon reinschauen können?\n\nDamit wir zeitnah live gehen können, brauchen wir noch dein Feedback:`,
    `vor ein paar Tagen haben wir Ihnen die Entwürfe für Ihre Recruiting-Kampagne geschickt. Hatten Sie schon Gelegenheit reinzuschauen?\n\nDamit wir zeitnah live gehen können, brauchen wir noch Ihr Feedback:`);
  const intro = (customText || '').trim() || defaultText;

  const content = `
    <tr><td style="padding:28px 32px 8px;">
      <p style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9a9994;margin:0 0 8px;">🔔 Kurze Erinnerung</p>
      <p style="font-size:15px;line-height:1.55;color:#0a0a0a;margin:0 0 14px;">${escape(gruss)},</p>
      <p style="font-size:15px;line-height:1.6;color:#2a2a2a;margin:0 0 18px;">${escape(intro).replace(/\n\n/g, '</p><p style="font-size:15px;line-height:1.6;color:#2a2a2a;margin:0 0 18px;">').replace(/\n/g, '<br>')}</p>
    </td></tr>
    <tr><td align="center" style="padding:0 32px 28px;">
      <a href="${escape(reviewUrl)}" style="display:inline-block;background:${brand.accent};color:${brand.accentInk};text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:100px;letter-spacing:0.02em;">→ Entwürfe ansehen &amp; freigeben</a>
    </td></tr>
    <tr><td style="padding:0 32px 24px;">
      <p style="font-size:13px;line-height:1.6;color:#5a5955;margin:0;">${t(k, 'Bei Fragen melde dich gerne jederzeit!', 'Bei Fragen melden Sie sich gerne jederzeit!')}</p>
      <p style="font-size:13px;line-height:1.6;color:#0a0a0a;margin:14px 0 0;font-weight:600;">${t(k, 'Dein', 'Ihr')} ${escape(brand.name)}-Team</p>
    </td></tr>`;

  const html = brandedShell({ brand, contentHtml: content });
  const text = `${gruss},\n\n${intro}\n\nEntwürfe ansehen & freigeben: ${reviewUrl}\n\n${t(k, 'Bei Fragen melde dich gerne jederzeit!', 'Bei Fragen melden Sie sich gerne jederzeit!')}\n${t(k, 'Dein', 'Ihr')} ${brand.name}-Team`;

  const recipients = Array.isArray(to) ? to : [to];
  const bccList = getInternalBcc([], recipients);
  console.log(`[sendEntwurfReminder] to=${recipients.join(',')} bcc=${bccList.join(',')}`);
  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: getMailFrom(brand),
      to: recipients,
      bcc: bccList,
      reply_to: getMailReplyTo(brand),
      subject: `Kurze Erinnerung: deine Entwürfe warten auf Freigabe`,
      html, text,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend ${response.status}: ${body.slice(0, 300)}`);
  }
  return await response.json();
}

/* ════════════════════ Kampagne pausiert — Kunden-Mail ════════════════════
   „Wir müssen dich kurz informieren: Deine Kampagne ist aktuell aufgrund
   technischer Probleme pausiert." — Absender + BCC + Reply-To wie bei
   sendKampagneLiveMail. */
/* ════════════════════ Termin-Einladung — Kunden-Mail ════════════════════
   Freundliche Du-Form-Einladung mit Calendly-Link, Branding + BCC. */
export async function sendTerminEinladung({
  to, kunde, ansprechpartner, agentur,
  subject, calLink, calLabel = 'Termin auswählen',
  customText, personLabel,
}) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY nicht gesetzt.');
  const brand = getBranding(agentur);
  const k = kunde || { ansprechpartner };
  const gruss = anrede(k);

  const bodyHtml = String(customText || '')
    .split(/\n\s*\n/)
    .map(p => `<p style="font-size:14.5px;line-height:1.65;color:#2a2a2a;margin:0 0 14px;">${escape(p).replace(/\n/g, '<br>')}</p>`)
    .join('');

  const content = `
    <tr><td style="padding:28px 32px 8px;">
      <p style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9a9994;margin:0 0 8px;">📅 Termin-Einladung${personLabel ? ` · Bei ${escape(personLabel)}` : ''}</p>
      <p style="font-size:15px;line-height:1.55;color:#0a0a0a;margin:0 0 14px;">${escape(gruss)},</p>
      ${bodyHtml}
    </td></tr>
    <tr><td align="center" style="padding:0 32px 28px;">
      <a href="${escape(calLink)}" style="display:inline-block;background:${brand.accent};color:${brand.accentInk};text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:100px;letter-spacing:0.02em;">→ ${escape(calLabel)}</a>
    </td></tr>
    <tr><td style="padding:0 32px 24px;">
      <p style="font-size:13px;line-height:1.6;color:#5a5955;margin:0;">Bei Fragen einfach auf diese Mail antworten.</p>
      <p style="font-size:13px;line-height:1.6;color:#0a0a0a;margin:14px 0 0;font-weight:600;">${t(k, 'Dein', 'Ihr')} ${escape(brand.name)}-Team</p>
    </td></tr>`;

  const html = brandedShell({ brand, contentHtml: content });
  const text = `${gruss},\n\n${customText || ''}\n\nTermin auswählen: ${calLink}\n\nBei Fragen einfach antworten.\n${t(k, 'Dein', 'Ihr')} ${brand.name}-Team`;

  const recipients = Array.isArray(to) ? to : [to];
  const bccList = getInternalBcc([], recipients);
  console.log(`[sendTerminEinladung] to=${recipients.join(',')} bcc=${bccList.join(',')} link=${calLink}`);

  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: getMailFrom(brand),
      to: recipients,
      bcc: bccList,
      reply_to: 'info@nowagwirth.com',
      subject: subject || 'Terminvorschlag',
      html, text,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend ${response.status}: ${body.slice(0, 300)}`);
  }
  return await response.json();
}

/* ════════════════════ Portal-Einladung — Kunden-Mail ════════════════════
   Erste Einrichtung eines Portal-Accounts: der Kunde bekommt einen Link
   mit Einladungs-Token, ueber den er sein Passwort setzt. Danach kann er
   sich mit E-Mail + Passwort einloggen. */
export async function sendPortalEinladung({ to, kunde, name, portalUrl, setupUrl, kundenname, agentur }) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY nicht gesetzt.');
  const brand = getBranding(agentur);
  const k = kunde || { ansprechpartner: name };
  const gruss = anrede(k);

  const content = `
    <tr><td style="padding:28px 32px 8px;">
      <p style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9a9994;margin:0 0 8px;">🔑 ${t(k, 'Dein', 'Ihr')} Zugang zum Kunden-Dashboard</p>
      <p style="font-size:15px;line-height:1.55;color:#0a0a0a;margin:0 0 14px;">${escape(gruss)},</p>
      <p style="font-size:15px;line-height:1.6;color:#2a2a2a;margin:0 0 18px;">
        ${t(k, 'wir haben für dich bei', 'wir haben für Sie bei')} <strong>${escape(kundenname || '')}</strong> ${t(k, 'einen Zugang zum Kampagnen-Dashboard eingerichtet. Dort siehst du alle Leads, kannst Notizen hinzufügen und die Pipeline pflegen.', 'einen Zugang zum Kampagnen-Dashboard eingerichtet. Dort sehen Sie alle Leads, können Notizen hinzufügen und die Pipeline pflegen.')}
      </p>
      <p style="font-size:15px;line-height:1.6;color:#2a2a2a;margin:0 0 18px;">
        ${t(k, 'Klick auf den Button unten, um dein Passwort zu setzen. Danach kannst du dich jederzeit mit deiner E-Mail-Adresse', 'Klicken Sie auf den Button unten, um Ihr Passwort zu setzen. Danach können Sie sich jederzeit mit Ihrer E-Mail-Adresse')} (<code>${escape(to)}</code>) ${t(k, 'und deinem Passwort einloggen.', 'und Ihrem Passwort einloggen.')}
      </p>
    </td></tr>
    <tr><td align="center" style="padding:0 32px 28px;">
      <a href="${escape(setupUrl)}" style="display:inline-block;background:${brand.accent};color:${brand.accentInk};text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:100px;letter-spacing:0.02em;">→ Passwort setzen &amp; loslegen</a>
      <p style="font-size:11px;color:#9a9994;margin:14px 0 0;">Dieser Link ist einmalig gültig.</p>
    </td></tr>
    <tr><td style="padding:0 32px 24px;">
      <p style="font-size:13px;line-height:1.6;color:#5a5955;margin:0;">Später-Zugang: <a href="${escape(portalUrl)}">${escape(portalUrl)}</a></p>
      <p style="font-size:13px;line-height:1.6;color:#0a0a0a;margin:14px 0 0;font-weight:600;">Dein ${escape(brand.name)}-Team</p>
    </td></tr>`;
  const html = brandedShell({ brand, contentHtml: content });
  const text = `${gruss},\n\n${t(k, 'wir haben für dich einen Zugang zum Kampagnen-Dashboard eingerichtet.', 'wir haben für Sie einen Zugang zum Kampagnen-Dashboard eingerichtet.')}\n\nPasswort setzen: ${setupUrl}\n\n${t(k, `Spaeter kannst du dich jederzeit mit deiner E-Mail-Adresse (${to}) und deinem Passwort einloggen.`, `Spaeter koennen Sie sich jederzeit mit Ihrer E-Mail-Adresse (${to}) und Ihrem Passwort einloggen.`)}\n\n${t(k, 'Dein', 'Ihr')} ${brand.name}-Team`;

  const recipients = Array.isArray(to) ? to : [to];
  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: getMailFrom(brand),
      to: recipients,
      bcc: getInternalBcc([], recipients),
      reply_to: getMailReplyTo(brand),
      subject: t(k, `Dein Zugang zum ${brand.name}-Portal`, `Ihr Zugang zum ${brand.name}-Portal`),
      html, text,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend ${response.status}: ${body.slice(0, 300)}`);
  }
  return await response.json();
}

export async function sendKampagnePauseMail({ to, kunde, ansprechpartner, customText }) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY nicht gesetzt.');
  const brand = getBranding(kunde?.agentur);
  const recipients = Array.isArray(to) ? to : [to];
  const k = kunde || { ansprechpartner };

  const introText = customText && customText.trim()
    ? customText.trim()
    : t(k,
        `${anrede(k)},\n\nwir müssen dich kurz informieren: Deine Kampagne ist aktuell aufgrund technischer Probleme pausiert. Wir arbeiten bereits an der Lösung und melden uns, sobald sie wieder live ist.\n\nDie Pausenzeit wird selbstverständlich hinten angehängt — dir entsteht kein Nachteil.`,
        `${anrede(k)},\n\nwir müssen Sie kurz informieren: Ihre Kampagne ist aktuell aufgrund technischer Probleme pausiert. Wir arbeiten bereits an der Lösung und melden uns, sobald sie wieder live ist.\n\nDie Pausenzeit wird selbstverständlich hinten angehängt — Ihnen entsteht kein Nachteil.`);

  const introHtml = introText
    .split(/\n\s*\n/)
    .map(p => `<p style="font-size:14.5px;line-height:1.65;color:#2a2a2a;margin:0 0 14px;">${escape(p).replace(/\n/g, '<br>')}</p>`)
    .join('');

  const content = `
    <tr><td style="padding:28px 32px 8px;">
      <p style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9a9994;margin:0 0 8px;">⏸ Kampagnen-Info · ${escape(brand.name)}</p>
      ${introHtml}
    </td></tr>
    <tr><td style="padding:0 32px 24px;">
      <p style="font-size:13px;line-height:1.6;color:#5a5955;margin:14px 0 0;">Bei Rückfragen einfach auf diese Mail antworten.</p>
      <p style="font-size:13px;line-height:1.6;color:#0a0a0a;margin:14px 0 0;font-weight:600;">${t(k, 'Danke für deine Geduld!', 'Danke für Ihre Geduld!')}<br>${t(k, 'Dein', 'Ihr')} ${escape(brand.name)}-Team</p>
    </td></tr>`;
  const html = brandedShell({ brand, contentHtml: content });
  const text = `${introText}\n\n${t(k, 'Danke für deine Geduld!', 'Danke für Ihre Geduld!')}\n${t(k, 'Dein', 'Ihr')} ${brand.name}-Team`;

  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: getMailFrom(brand),
      to: recipients,
      bcc: getInternalBcc([], recipients),
      reply_to: getMailReplyTo(brand),
      subject: '⏸ Deine Kampagne ist kurz pausiert',
      html, text,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend ${response.status}: ${body.slice(0, 300)}`);
  }
  return await response.json();
}

/* ════════════════════ Angebots-Mail (Phase 4b) ════════════════════
   Absender: angebote@talent-one.de bzw. angebote@nowagwirth.com — siehe
   getOfferMailFrom. Reply-To einheitlich: info@nowagwirth.de.
   BCC ans Team wie bei allen Kundenmails. Angebot als PDF im Anhang. */
export async function sendAngebotMail({
  to, offerBrand, subject, body, pdfBuffer, pdfFilename,
  extraAttachments = [],   // [{ filename, content: Buffer|string(base64) }, ...]
}) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY nicht gesetzt.');
  const brand = getBranding(agenturForOfferBrand(offerBrand));
  const recipients = Array.isArray(to) ? to : [to];

  const bodyHtml = String(body || '')
    .split(/\n\s*\n/)
    .map(p => `<p style="font-size:14.5px;line-height:1.65;color:#2a2a2a;margin:0 0 14px;">${escape(p).replace(/\n/g, '<br>')}</p>`)
    .join('');

  const content = `
    <tr><td style="padding:28px 32px 8px;">
      <p style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9a9994;margin:0 0 8px;">📄 Angebot · ${escape(brand.name)}</p>
      ${bodyHtml}
    </td></tr>
    <tr><td style="padding:0 32px 24px;">
      <p style="font-size:13px;line-height:1.6;color:#5a5955;margin:14px 0 0;">Bei Fragen einfach auf diese Mail antworten.</p>
    </td></tr>`;
  const html = brandedShell({ brand, contentHtml: content });
  const text = String(body || '');

  const attachments = [];
  if (pdfBuffer) attachments.push({
    filename: pdfFilename || 'Angebot.pdf',
    content: Buffer.isBuffer(pdfBuffer) ? pdfBuffer.toString('base64') : pdfBuffer,
  });
  for (const att of (extraAttachments || [])) {
    if (!att?.filename || !att?.content) continue;
    attachments.push({
      filename: att.filename,
      content: Buffer.isBuffer(att.content) ? att.content.toString('base64') : att.content,
    });
  }

  const bccList = getInternalBcc([], recipients);
  console.log(`[sendAngebotMail] to=${recipients.join(',')} bcc=${bccList.join(',')} brand=${offerBrand}`);
  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: getOfferMailFrom(brand),
      to: recipients,
      bcc: bccList,
      reply_to: getOfferMailReplyTo(brand),
      subject: subject || 'Ihr Angebot',
      html, text,
      attachments,
    }),
  });
  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Resend ${response.status}: ${errBody.slice(0, 300)}`);
  }
  return await response.json();
}

/* ════════════════════ Auftragsbestätigungs-Mail ════════════════════
   Zwei Entstehungswege: (a) klassisch Angebot → AB (Rücksync) und
   (b) Direkt-AB aus dem Wizard. Beide nutzen denselben Absender +
   BCC-Regel wie das Angebot. */
export async function sendAuftragMail({
  to, offerBrand, subject, body, pdfBuffer, pdfFilename,
  extraAttachments = [],
}) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY nicht gesetzt.');
  const brand = getBranding(agenturForOfferBrand(offerBrand));
  const recipients = Array.isArray(to) ? to : [to];

  const bodyHtml = String(body || '')
    .split(/\n\s*\n/)
    .map(p => `<p style="font-size:14.5px;line-height:1.65;color:#2a2a2a;margin:0 0 14px;">${escape(p).replace(/\n/g, '<br>')}</p>`)
    .join('');

  const content = `
    <tr><td style="padding:28px 32px 8px;">
      <p style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9a9994;margin:0 0 8px;">📋 Auftragsbestätigung · ${escape(brand.name)}</p>
      ${bodyHtml}
    </td></tr>
    <tr><td style="padding:0 32px 24px;">
      <p style="font-size:13px;line-height:1.6;color:#5a5955;margin:14px 0 0;">Bei Fragen einfach auf diese Mail antworten.</p>
    </td></tr>`;
  const html = brandedShell({ brand, contentHtml: content });
  const text = String(body || '');

  const attachments = [];
  if (pdfBuffer) attachments.push({
    filename: pdfFilename || 'Auftragsbestaetigung.pdf',
    content: Buffer.isBuffer(pdfBuffer) ? pdfBuffer.toString('base64') : pdfBuffer,
  });
  for (const att of (extraAttachments || [])) {
    if (!att?.filename || !att?.content) continue;
    attachments.push({
      filename: att.filename,
      content: Buffer.isBuffer(att.content) ? att.content.toString('base64') : att.content,
    });
  }

  const bccList = getInternalBcc([], recipients);
  console.log(`[sendAuftragMail] to=${recipients.join(',')} bcc=${bccList.join(',')} brand=${offerBrand}`);
  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: getOfferMailFrom(brand),
      to: recipients,
      bcc: bccList,
      reply_to: getOfferMailReplyTo(brand),
      subject: subject || 'Ihre Auftragsbestätigung',
      html, text,
      attachments,
    }),
  });
  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Resend ${response.status}: ${errBody.slice(0, 300)}`);
  }
  return await response.json();
}

/* ════════════════════ Rechnungs-Mail ════════════════════
   Deckt sowohl Setup-/Monats-/AB-abgeleitete Rechnungen als auch die
   freistehende Werbekosten-Rechnung ab. Absender + BCC wie beim Angebot. */
export async function sendRechnungMail({
  to, offerBrand, subject, body, pdfBuffer, pdfFilename,
}) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY nicht gesetzt.');
  const brand = getBranding(agenturForOfferBrand(offerBrand));
  const recipients = Array.isArray(to) ? to : [to];

  const bodyHtml = String(body || '')
    .split(/\n\s*\n/)
    .map(p => `<p style="font-size:14.5px;line-height:1.65;color:#2a2a2a;margin:0 0 14px;">${escape(p).replace(/\n/g, '<br>')}</p>`)
    .join('');

  const content = `
    <tr><td style="padding:28px 32px 8px;">
      <p style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9a9994;margin:0 0 8px;">📄 Rechnung · ${escape(brand.name)}</p>
      ${bodyHtml}
    </td></tr>
    <tr><td style="padding:0 32px 24px;">
      <p style="font-size:13px;line-height:1.6;color:#5a5955;margin:14px 0 0;">Bei Fragen einfach auf diese Mail antworten.</p>
    </td></tr>`;
  const html = brandedShell({ brand, contentHtml: content });
  const text = String(body || '');

  const attachments = [];
  if (pdfBuffer) attachments.push({
    filename: pdfFilename || 'Rechnung.pdf',
    content: Buffer.isBuffer(pdfBuffer) ? pdfBuffer.toString('base64') : pdfBuffer,
  });

  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: getOfferMailFrom(brand),
      to: recipients,
      bcc: getInternalBcc([], recipients),
      reply_to: getOfferMailReplyTo(brand),
      subject: subject || 'Ihre Rechnung',
      html, text,
      attachments,
    }),
  });
  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Resend ${response.status}: ${errBody.slice(0, 300)}`);
  }
  return await response.json();
}

/* ════════════════════ Einstellungs-Mail (Phase 5 Nachtrag) ════════════════════
   Absender wie beim Angebotsversand: angebote@… + Reply-To info@nowagwirth.de.
   Ruft dieselbe getOfferMailFrom/-ReplyTo/-BCC-Logik auf. */
export async function sendEinstellungsMail({
  to, offerBrand, subject, body,
}) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY nicht gesetzt.');
  const brand = getBranding(agenturForOfferBrand(offerBrand));
  const recipients = Array.isArray(to) ? to : [to];

  const bodyHtml = String(body || '')
    .split(/\n\s*\n/)
    .map(p => `<p style="font-size:14.5px;line-height:1.65;color:#2a2a2a;margin:0 0 14px;">${escape(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  const content = `
    <tr><td style="padding:28px 32px 8px;">
      <p style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9a9994;margin:0 0 8px;">🎉 Einstellung erfasst · ${escape(brand.name)}</p>
      ${bodyHtml}
    </td></tr>
    <tr><td style="padding:0 32px 24px;">
      <p style="font-size:13px;line-height:1.6;color:#5a5955;margin:14px 0 0;">Bei Fragen einfach auf diese Mail antworten.</p>
    </td></tr>`;
  const html = brandedShell({ brand, contentHtml: content });
  const text = String(body || '');

  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: getOfferMailFrom(brand),
      to: recipients,
      bcc: getInternalBcc([], recipients),
      reply_to: getOfferMailReplyTo(brand),
      subject: subject || 'Einstellung erfasst',
      html, text,
    }),
  });
  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Resend ${response.status}: ${errBody.slice(0, 300)}`);
  }
  return await response.json();
}

/* ════════════════════ Rechnungs-Erinnerungsmail (Phase 5) ════════════════════
   reminder_email-Template + Merge-Tags. Absender wie Angebote:
   angebote@… mit info@nowagwirth.de als Reply-To + BCC ans Team. */
export async function sendErinnerungsMail({
  to, offerBrand, subject, body,
}) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY nicht gesetzt.');
  const brand = getBranding(agenturForOfferBrand(offerBrand));
  const recipients = Array.isArray(to) ? to : [to];
  const bodyHtml = String(body || '')
    .split(/\n\s*\n/)
    .map(p => `<p style="font-size:14.5px;line-height:1.65;color:#2a2a2a;margin:0 0 14px;">${escape(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  const content = `
    <tr><td style="padding:28px 32px 8px;">
      <p style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9a9994;margin:0 0 8px;">📩 Zahlungserinnerung · ${escape(brand.name)}</p>
      ${bodyHtml}
    </td></tr>`;
  const html = brandedShell({ brand, contentHtml: content });
  const text = String(body || '');
  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: getOfferMailFrom(brand),
      to: recipients,
      bcc: getInternalBcc([], recipients),
      reply_to: getOfferMailReplyTo(brand),
      subject: subject || 'Erinnerung: offene Rechnung',
      html, text,
    }),
  });
  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Resend ${response.status}: ${errBody.slice(0, 300)}`);
  }
  return await response.json();
}

/* Kleine Mail an den Kunden: "Worauf sollen wir bei der Vorqualifizierung achten?"
   Link fuehrt ins Portal, wo der Kunde die Kriterien selbst pflegen kann. */
export async function sendKriterienAnfrage({ to, kunde, job, portalUrl, customText }) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY nicht gesetzt.');
  const brand = getBranding(kunde?.agentur);
  const k = kunde || {};
  const stelle = job?.stelle || t(k, 'deine offene Stelle', 'Ihre offene Stelle');

  const intro = (customText || '').trim() || t(k,
    `wir telefonieren gerade die Bewerber für ${stelle} vor. Damit wir genau auf das achten, was dir wichtig ist: Was sind deine wichtigsten Kriterien?\n\nÜber den Link unten kannst du sie direkt eintragen — dauert 2 Minuten. Wir prüfen sie dann bei jedem Bewerber systematisch ab.`,
    `wir telefonieren gerade die Bewerber für ${stelle} vor. Damit wir genau auf das achten, was Ihnen wichtig ist: Was sind Ihre wichtigsten Kriterien?\n\nÜber den Link unten können Sie sie direkt eintragen — dauert 2 Minuten. Wir prüfen sie dann bei jedem Bewerber systematisch ab.`);

  const introHtml = intro
    .split(/\n\s*\n/)
    .map(p => `<p style="font-size:14.5px;line-height:1.65;color:#2a2a2a;margin:0 0 14px;">${escape(p).replace(/\n/g, '<br>')}</p>`)
    .join('');

  const content = `
    <tr><td style="padding:28px 32px 8px;">
      <p style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9a9994;margin:0 0 8px;">⭐ Prüf-Kriterien · ${escape(brand.name)}</p>
      <p style="font-size:15px;line-height:1.55;color:#0a0a0a;margin:0 0 14px;">${escape(anrede(k))},</p>
      ${introHtml}
    </td></tr>
    <tr><td align="center" style="padding:0 32px 28px;">
      <a href="${escape(portalUrl)}" style="display:inline-block;background:${brand.accent};color:${brand.accentInk};text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:100px;letter-spacing:0.02em;">→ ${t(k, 'Kriterien eintragen', 'Kriterien eintragen')}</a>
    </td></tr>
    <tr><td style="padding:0 32px 24px;">
      <p style="font-size:13px;line-height:1.6;color:#5a5955;margin:0;">${t(k, 'Bei Fragen einfach auf diese Mail antworten.', 'Bei Fragen einfach auf diese Mail antworten.')}</p>
      <p style="font-size:13px;line-height:1.6;color:#0a0a0a;margin:14px 0 0;font-weight:600;">${t(k, 'Dein', 'Ihr')} ${escape(brand.name)}-Team</p>
    </td></tr>`;

  const html = brandedShell({ brand, contentHtml: content });
  const text = `${anrede(k)},\n\n${intro}\n\nKriterien eintragen: ${portalUrl}\n\n${t(k, 'Dein', 'Ihr')} ${brand.name}-Team`;
  const recipients = Array.isArray(to) ? to : [to];

  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: getMailFrom(brand),
      to: recipients,
      bcc: getInternalBcc([], recipients),
      reply_to: getMailReplyTo(brand),
      subject: t(k, `Worauf sollen wir achten? — ${stelle}`, `Worauf sollen wir achten? — ${stelle}`),
      html, text,
    }),
  });
  if (!response.ok) throw new Error(`Resend: ${await response.text()}`);
  return response.json();
}

/* Intern: Kunde hat die Pruef-Kriterien im Portal angepasst. */
export async function sendKriterienGeaendertNotiz({ kunde, job, vorher = [], nachher = [], geaendert_von }) {
  const fmt = (list) => list.length
    ? list.map(k => `${k.pflicht ? '❗ ' : ''}${k.kriterium}${k.anforderung ? ` — ${k.anforderung}` : ''}`).join('<br>')
    : '<em>(keine)</em>';
  const jobUrl = `${(process.env.INSIDE_BASE_URL || 'https://inside.talent-one.de')}/kunden/${kunde?.id}/jobs/${job?.id}/stelle`;

  const html = `
    <p style="font-size:14px;color:#0a0a0a;margin:0 0 10px;"><strong>${escape(kunde?.firmenname || 'Kunde')}</strong> hat die Prüf-Kriterien angepasst.</p>
    <p style="font-size:13px;color:#5a5955;margin:0 0 14px;">Stelle: <strong>${escape(job?.stelle || '—')}</strong> · geändert von ${escape(geaendert_von || 'Kunde')}</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr>
        <td style="vertical-align:top;padding:10px;background:#fafaf8;border:1px solid #ececea;width:50%;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#9a9994;margin-bottom:6px;">Vorher</div>${fmt(vorher)}
        </td>
        <td style="vertical-align:top;padding:10px;background:#f0fdf4;border:1px solid #bbf7d0;width:50%;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#166534;margin-bottom:6px;">Jetzt</div>${fmt(nachher)}
        </td>
      </tr>
    </table>
    <p style="margin:16px 0 0;"><a href="${escape(jobUrl)}" style="color:#0a0a0a;font-weight:600;">→ Zur Stelle</a></p>`;

  const text = `${kunde?.firmenname || 'Kunde'} hat die Prüf-Kriterien angepasst.\nStelle: ${job?.stelle || '—'}\nGeändert von: ${geaendert_von || 'Kunde'}\n\n${jobUrl}`;

  return sendInternalNotification({
    subject: `⭐ Kriterien angepasst — ${kunde?.firmenname || 'Kunde'} (${job?.stelle || 'Stelle'})`,
    html, text,
  });
}
