// Mail-Versand via Resend für TalentOne Inside.
// Branding pro Agentur via getBranding() / getMailFrom() / getMailReplyTo().

import { getBranding, getMailFrom, getMailReplyTo } from './branding.js';

const RESEND_API = 'https://api.resend.com/emails';

// Intern (Mitarbeiter-Benachrichtigungen) — immer TalentOne-Absender
const INTERNAL_FROM = 'TalentOne Inside <noreply@talent-one.de>';

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

export async function sendUploadAnfrage({ to, kundenname, ansprechpartner, uploadUrl, customText, agentur }) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY nicht gesetzt.');
  }
  const brand = getBranding(agentur);
  const grußname = ansprechpartner || 'zusammen';
  const intro = (customText || '').trim() || `wir bereiten gerade eure Recruiting-Kampagne vor und brauchen dafür ein paar Materialien von euch. Über den unten stehenden Link könnt ihr ganz einfach euer Logo und Fotos vom Team / Arbeitsplatz hochladen.`;

  const content = `
    <tr><td style="padding:28px 32px 8px;">
      <p style="font-size:15px;line-height:1.55;color:#0a0a0a;margin:0 0 14px;">Hallo ${escape(grußname)},</p>
      <p style="font-size:15px;line-height:1.6;color:#2a2a2a;margin:0 0 18px;">${escape(intro).replace(/\n/g, '<br>')}</p>
      <p style="font-size:14px;line-height:1.6;color:#2a2a2a;margin:0 0 22px;">Was wir uns wünschen würden:</p>
      <ul style="font-size:14px;line-height:1.7;color:#2a2a2a;margin:0 0 24px;padding-left:18px;">
        <li><strong>Euer Logo</strong> in guter Qualität (PNG, JPG, SVG)</li>
        <li><strong>3–5 Fotos vom Arbeitsplatz, Team oder typische Tätigkeiten</strong> — gerne auch Handy-Schnappschüsse</li>
      </ul>
    </td></tr>
    <tr><td align="center" style="padding:0 32px 28px;">
      <a href="${escape(uploadUrl)}" style="display:inline-block;background:${brand.primary};color:${brand.accent};text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:100px;letter-spacing:0.02em;">→ Dateien hochladen</a>
      <p style="font-size:11px;color:#9a9994;margin:14px 0 0;">Der Link ist persönlich und nur für ${escape(kundenname)} gültig.</p>
    </td></tr>
    <tr><td style="padding:0 32px 24px;">
      <p style="font-size:13px;line-height:1.6;color:#5a5955;margin:0;">Falls etwas unklar ist, einfach auf diese Mail antworten — wir helfen gern.<br>Vielen Dank im Voraus!</p>
      <p style="font-size:13px;line-height:1.6;color:#0a0a0a;margin:14px 0 0;font-weight:600;">Euer ${escape(brand.name)}-Team</p>
    </td></tr>`;

  const html = brandedShell({ brand, contentHtml: content });
  const text = `Hallo ${grußname},\n\n${intro}\n\nWas wir uns wünschen:\n• Euer Logo (PNG/JPG/SVG)\n• 3-5 Fotos vom Arbeitsplatz, Team oder typischen Tätigkeiten\n\nUpload-Link: ${uploadUrl}\n\n(Der Link ist persönlich und nur für ${kundenname} gültig.)\n\nVielen Dank!\nEuer ${brand.name}-Team`;

  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: getMailFrom(brand),
      to,
      reply_to: getMailReplyTo(brand),
      subject: 'Wir brauchen noch Logo und Fotos für eure Kampagne',
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

/* ─────────────────── Formular-Einladung an Kunde ─────────────────── */

export async function sendFormularEinladung({ to, ansprechpartner, formularUrl, customText, agentur }) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY nicht gesetzt.');
  const brand = getBranding(agentur);
  const grußname = ansprechpartner || 'zusammen';
  const intro = (customText || '').trim() || `wir freuen uns auf eure Recruiting-Kampagne! Damit wir starten können, haben wir ein kurzes Briefing-Formular für euch vorbereitet — dort tragt ihr alles rund um eure offene Stelle, eure Benefits und euer Unternehmen ein. Dauert etwa 10 Minuten.`;

  const content = `
    <tr><td style="padding:28px 32px 8px;">
      <p style="font-size:15px;line-height:1.55;color:#0a0a0a;margin:0 0 14px;">Hallo ${escape(grußname)},</p>
      <p style="font-size:15px;line-height:1.6;color:#2a2a2a;margin:0 0 18px;">${escape(intro).replace(/\n/g, '<br>')}</p>
      <p style="font-size:14px;line-height:1.6;color:#2a2a2a;margin:0 0 18px;">Im Formular fragen wir ab:</p>
      <ul style="font-size:14px;line-height:1.7;color:#2a2a2a;margin:0 0 22px;padding-left:18px;">
        <li>Eure offene Stelle und was sie besonders macht</li>
        <li>Benefits und Arbeitsumfeld</li>
        <li>Logo + ein paar Fotos von euch</li>
      </ul>
      <p style="font-size:14px;line-height:1.6;color:#2a2a2a;margin:0 0 22px;">
        <strong>Tipp:</strong> Falls ihr eine bestehende Stellenanzeige als URL oder PDF habt, könnt ihr sie oben im Formular einfügen — wir lesen sie automatisch aus, ihr passt nur noch an.
      </p>
    </td></tr>
    <tr><td align="center" style="padding:0 32px 28px;">
      <a href="${escape(formularUrl)}" style="display:inline-block;background:${brand.primary};color:${brand.accent};text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:100px;letter-spacing:0.02em;">→ Formular ausfüllen</a>
      <p style="font-size:11px;color:#9a9994;margin:14px 0 0;">Der Link ist persönlich für euch.</p>
    </td></tr>
    <tr><td style="padding:0 32px 24px;">
      <p style="font-size:13px;line-height:1.6;color:#5a5955;margin:0;">Fragen? Einfach auf diese Mail antworten.</p>
      <p style="font-size:13px;line-height:1.6;color:#0a0a0a;margin:14px 0 0;font-weight:600;">Euer ${escape(brand.name)}-Team</p>
    </td></tr>`;

  const html = brandedShell({ brand, contentHtml: content });
  const text = `Hallo ${grußname},\n\n${intro}\n\nLink zum Formular: ${formularUrl}\n\nVielen Dank!\nEuer ${brand.name}-Team`;

  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: getMailFrom(brand),
      to,
      reply_to: getMailReplyTo(brand),
      subject: 'Kurzes Briefing-Formular für eure Recruiting-Kampagne',
      html, text,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend ${response.status}: ${body.slice(0, 300)}`);
  }
  return await response.json();
}

/* ─────────────────── Mitarbeiter-Benachrichtigung (intern, immer TalentOne) ─────────────────── */

export async function sendFormularEingang({ to, kundenname, kundeUrl }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[mail] RESEND_API_KEY nicht gesetzt — Mitarbeiter-Mail übersprungen.');
    return null;
  }

  const html = `<!doctype html>
<html lang="de"><body style="margin:0;padding:0;background:#f0efed;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#0a0a0a;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0efed;padding:32px 0;"><tr><td align="center">
<table width="540" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;max-width:540px;width:100%;">
  <tr><td style="background:#0a0a0a;padding:20px 28px;">
    <span style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:-0.02em;">Talent<span style="color:#d4ff00;">One</span> · Inside</span>
  </td></tr>
  <tr><td style="padding:24px 28px;">
    <h1 style="font-size:20px;margin:0 0 8px;font-weight:700;letter-spacing:-0.02em;">Formular ausgefüllt</h1>
    <p style="font-size:14px;line-height:1.55;color:#2a2a2a;margin:0 0 18px;"><strong>${escape(kundenname || 'Ein Kunde')}</strong> hat das Briefing-Formular ausgefüllt — das Projekt ist startklar.</p>
    <a href="${kundeUrl}" style="display:inline-block;background:#0a0a0a;color:#d4ff00;text-decoration:none;font-weight:700;font-size:14px;padding:12px 24px;border-radius:100px;">→ Kunde im Inside-Tool öffnen</a>
  </td></tr>
</table></td></tr></table></body></html>`;

  try {
    const response = await fetch(RESEND_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: INTERNAL_FROM, to,
        subject: `[Inside] Formular ausgefüllt: ${kundenname || 'Neuer Kunde'}`,
        html,
        text: `${kundenname || 'Ein Kunde'} hat das Briefing-Formular ausgefüllt.\nLink: ${kundeUrl}`,
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      console.warn(`[mail] Mitarbeiter-Benachrichtigung fehlgeschlagen ${response.status}: ${body.slice(0, 200)}`);
    }
    return response.ok;
  } catch (err) {
    console.warn('[mail] Mitarbeiter-Benachrichtigung Fehler:', err.message);
    return false;
  }
}
