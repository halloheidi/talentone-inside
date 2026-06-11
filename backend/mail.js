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
      <a href="${escape(uploadUrl)}" style="display:inline-block;background:${brand.accent};color:${brand.accentInk};text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:100px;letter-spacing:0.02em;">→ Dateien hochladen</a>
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
      <a href="${escape(formularUrl)}" style="display:inline-block;background:${brand.accent};color:${brand.accentInk};text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:100px;letter-spacing:0.02em;">→ Formular ausfüllen</a>
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

export async function sendReviewBenachrichtigung({ kunde, job, status, kommentare, jobUrl, creatives = [], adcopies = [] }) {
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
      const c = creativesById.get(id);
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
      return `<strong>Creative</strong> <span style="color:#9a9994;font-size:11px;">${escape(id.slice(0, 8))}…</span>`;
    }
    if (k.startsWith('adcopy_')) {
      const id = k.slice('adcopy_'.length);
      const a = adcopiesById.get(id);
      const stilLabel = a?.stil ? (STIL_LABEL[a.stil] || a.stil) : 'Ad-Copy';
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
      <p style="font-size:13px;line-height:1.6;color:#0a0a0a;margin:14px 0 0;font-weight:600;">Euer ${escape(brand.name)}-Team</p>
    </td></tr>`;

  const html = brandedShell({ brand, contentHtml: content });
  const text = `Rechnung für ${stelle}\n\nBetrag: ${betragStr}\nBeschreibung: ${zahlung.beschreibung || ''}\n${zahlung.faelligkeit ? `Fällig: ${new Date(zahlung.faelligkeit).toLocaleDateString('de-DE')}\n` : ''}\nJetzt bezahlen: ${zahlung.pay_link}\n\nViele Grüße\nEuer ${brand.name}-Team`;

  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: getMailFrom(brand),
      to: recipients,
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
      <p style="font-size:14px;color:#5a5955;margin:0 0 18px;">Vielen Dank für eure Zahlung! Anbei erhaltet ihr eure Rechnung als PDF im Anhang.</p>
      <p style="font-size:13px;line-height:1.6;color:#5a5955;margin:0 0 6px;">${escape(zahlung.beschreibung || '')}</p>
    </td></tr>
    <tr><td style="padding:0 32px 24px;">
      <p style="font-size:13px;line-height:1.6;color:#5a5955;margin:14px 0 0;">Bei Fragen einfach auf diese Mail antworten.</p>
      <p style="font-size:13px;line-height:1.6;color:#0a0a0a;margin:14px 0 0;font-weight:600;">Euer ${escape(brand.name)}-Team</p>
    </td></tr>`;

  const html = brandedShell({ brand, contentHtml: content });
  const text = `Rechnung ${rechnungsNr}\n\n${zahlung.beschreibung || ''}\n\nDie Rechnung findet ihr im Anhang.\n\nViele Grüße\nEuer ${brand.name}-Team`;

  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: getMailFrom(brand),
      to: recipients,
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
