// Export-Helpers: ZIP-Stream der Creatives, PDF-Generator für Ad-Copies,
// Anschreiben-Vorschlag via Claude, Mail-Versand via Resend mit eingebetteten Bildern.

import archiver from 'archiver';
import PDFDocument from 'pdfkit';
import { callClaudeWithRetry, parseJsonContent } from './claude.js';
import { fetchAsBuffer } from './storage.js';
import { getBranding, getMailFrom, getMailReplyTo, getPublicBaseUrl } from './branding.js';
import { getInternalBcc } from './mail.js';
import { anrede, t, anredePromptHinweis } from './anrede.js';
import { renderEmail } from './email-templates.js';

const VORQUAL_BCC = 'jessica.buchmueller@nowagwirth.de';

const CLAUDE_MODEL = 'claude-sonnet-4-6';
const RESEND_API = 'https://api.resend.com/emails';

export { getBranding };

const STYLE_LABEL = {
  emotional: 'Emotional / Story',
  benefit:   'Benefit-fokussiert',
  kompakt:   'Knackig / Hook',
};

const FORMAT_LABEL = {
  quadrat: '1x1',
  story:   '9x16',
};

export function sanitizeFilename(s = '') {
  return String(s)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64) || 'datei';
}

/* ───────────────────── ZIP der Creatives ───────────────────── */

// Streamt ein ZIP direkt in res. job + kunde nur für Filenames + Naming.
export async function streamCreativesZip(res, { job, kunde, creatives }) {
  const firma = sanitizeFilename(kunde?.firmenname || 'Kunde');
  const jobName = sanitizeFilename(job?.stelle || 'Stelle');
  const zipName = `${firma}_${jobName}_creatives.zip`;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', err => {
    console.error('[zip]', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.destroy(err);
  });
  archive.pipe(res);

  // Pro Format: zähle hoch, sodass Filenames eindeutig sind
  const counts = {};
  for (const c of creatives) {
    if (!c.bild_url) continue;
    try {
      const { buffer, contentType } = await fetchAsBuffer(c.bild_url);
      const fmtLabel = FORMAT_LABEL[c.format] || c.format || 'creative';
      counts[fmtLabel] = (counts[fmtLabel] || 0) + 1;
      const idx = counts[fmtLabel];
      let ext = 'png';
      if (c.typ === 'video') ext = 'mp4';
      else if (contentType?.includes('jpeg')) ext = 'jpg';
      else if (contentType?.includes('webp')) ext = 'webp';
      const filename = `${firma}_${jobName}_${fmtLabel}_${idx}.${ext}`;
      archive.append(buffer, { name: filename });
    } catch (err) {
      console.warn(`[zip] ${c.id} skip: ${err.message}`);
    }
  }

  await archive.finalize();
}

/* ───────────────────── PDF der Ad-Copies ───────────────────── */

export async function streamAdCopiesPdf(res, { job, kunde, adcopies }) {
  const firma = sanitizeFilename(kunde?.firmenname || 'Kunde');
  const jobName = sanitizeFilename(job?.stelle || 'Stelle');
  const pdfName = `${firma}_${jobName}_AdCopies.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${pdfName}"`);

  // PDFKit setup
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 56, bottom: 56, left: 56, right: 56 },
    info: {
      Title: `${kunde?.firmenname || ''} — ${job?.stelle || ''} Ad-Copies`,
      Author: 'TalentOne Inside',
    },
  });
  doc.pipe(res);

  // Logo wenn vorhanden
  if (kunde?.logo_url) {
    try {
      const { buffer } = await fetchAsBuffer(kunde.logo_url);
      doc.image(buffer, 56, 50, { fit: [60, 60] });
    } catch (err) {
      console.warn('[pdf] Logo skip:', err.message);
    }
  }

  // Header
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(22).fillColor('#0a0a0a')
    .text(kunde?.firmenname || 'Kunde', 130, 56);
  doc.font('Helvetica').fontSize(14).fillColor('#5a5955')
    .text(job?.stelle || 'Stelle', 130, 84);
  if (job?.region) {
    doc.fontSize(11).fillColor('#9a9994').text(job.region, 130, 105);
  }

  // Trennlinie
  doc.moveTo(56, 140).lineTo(540, 140).strokeColor('#ececea').lineWidth(1).stroke();
  doc.y = 160;

  // Pro Style ein Block
  const sorted = ['emotional', 'benefit', 'kompakt']
    .map(s => adcopies.find(a => a.stil === s))
    .filter(Boolean);
  for (const a of sorted) {
    if (doc.y > 720) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#0a0a0a')
      .text(STYLE_LABEL[a.stil] || a.stil, { lineGap: 4 });
    doc.moveDown(0.4);
    doc.font('Helvetica').fontSize(11).fillColor('#2a2a2a')
      .text(a.text || '', { lineGap: 4, paragraphGap: 6 });
    doc.moveDown(1.4);
  }

  // Footer
  const pageHeight = doc.page.height;
  doc.fontSize(9).fillColor('#9a9994')
    .text('Made with ❤️ by TalentOne · talent-one.de',
      56, pageHeight - 42, { align: 'center', width: 484 });

  doc.end();
}

/* ───────────────────── Anschreiben-Vorschlag (Claude) ───────────────────── */

export async function generateAnschreibensVorschlag(job, kunde) {
  const brand = getBranding(kunde?.agentur);
  // Anrede-Form kommt vom Kunden — vorher stand hier fest "Sie-Anrede", waehrend
  // das Mail-Template duzt. Genau daraus entstand die Mischform
  // ("Deine Entwuerfe" + "schicken wir Ihnen").
  const prompt = `Du schreibst eine kurze, professionelle Mail von der Agentur "${brand.name}" an einen Kunden, dem wir die ersten Recruiting-Kampagnen-Entwürfe schicken (Bilder, Texte, Bewerbungs-Funnel, Review-Link zum Kommentieren). Sprache: Deutsch, ${anredePromptHinweis(kunde)} (keine Floskeln wie "Sehr geehrte Damen und Herren").

WICHTIG: Verwende durchgängig NUR diese eine Anredeform — niemals mischen.
Beginne exakt mit der Grußzeile "${anrede(kunde)}," (genau so, danach Leerzeile).

Kontext:
- Kunde: ${kunde?.firmenname || '-'}
- Ansprechpartner: ${kunde?.ansprechpartner || '-'}
- Stelle: ${job?.stelle || '-'}

Schreibe 3-4 Sätze Anschreiben:
- Erster Satz: hier sind die ersten Entwürfe zur Stelle
- Was drin ist (Bilder + Texte + Funnel-Link), kurz
- Bitte um Feedback / Änderungswünsche
- Freundlicher Abschluss-Satz

NUR JSON zurück, keine Markdown-Backticks:
{ "text": "<dein Anschreiben>" }`;

  const data = await callClaudeWithRetry({
    model: CLAUDE_MODEL,
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  });
  const parsed = parseJsonContent(data);
  return (parsed.text || '').trim();
}

/* ───────────────────── Bewerbungs-Mail an Kunden ───────────────────── */

export async function sendBewerbungsMail({ kunde, job, bewerbung, sheetUrl }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[bewerbungs-mail] RESEND_API_KEY fehlt — überspringe.');
    return null;
  }
  const recipientRaw = (job?.bewerbung_email?.trim() || kunde?.email?.trim() || '');
  const recipients = recipientRaw
    .split(/[;,]/)
    .map(s => s.trim())
    .filter(s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
  if (recipients.length === 0) {
    console.warn('[bewerbungs-mail] Kein gültiger Empfänger — überspringe.');
    return null;
  }

  const brand = getBranding(kunde?.agentur);
  const isKo = !!bewerbung?.ko_kriterium;
  const stelle = escape(job?.stelle || 'Stelle');
  const region = escape(job?.region || '');
  const name = escape(bewerbung?.name || 'Unbekannt');
  const email = escape(bewerbung?.email || '');
  const telefon = escape(bewerbung?.telefon || '');
  const quelle = bewerbung?.quelle === 'perspective' ? 'Perspective.co' : 'Funnel';

  const antworten = Array.isArray(bewerbung?.antworten) ? bewerbung.antworten : [];
  const antwortenHtml = antworten.length === 0 ? '' : `
<h2 style="font-size:14px;font-weight:700;color:#0a0a0a;margin:24px 0 10px;">Antworten</h2>
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
${antworten.map(a => `
  <tr>
    <td style="padding:8px 0;border-bottom:1px solid #ececea;font-size:12px;color:#5a5955;width:45%;vertical-align:top;">${escape(a.frage_text || a.frage_id || '—')}</td>
    <td style="padding:8px 0;border-bottom:1px solid #ececea;font-size:13px;color:#0a0a0a;font-weight:500;">${escape(typeof a.antwort === 'object' ? JSON.stringify(a.antwort) : (a.antwort || '—'))}</td>
  </tr>`).join('')}
</table>`;

  const koWarning = isKo ? `
<div style="margin:20px 0;padding:14px 16px;background:#fff3cd;border:1px solid #f2d76b;border-left:4px solid #d4a800;border-radius:8px;font-size:13px;color:#5a4a00;">
  ⚠️ <strong>Achtung:</strong> Der Bewerber hat ein KO-Kriterium ausgelöst und erfüllt damit nicht alle Anforderungen dieser Stelle.
</div>` : '';

  const bewerbungenUrl = job?.bewerbungen_token
    ? `${getPublicBaseUrl(kunde?.agentur)}/bewerbungen/${job.bewerbungen_token}`
    : null;

  const bewerbungenButtonHtml = bewerbungenUrl ? `
<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;">
  <tr><td align="center" style="padding:6px 0;">
    <a href="${escape(bewerbungenUrl)}" style="display:inline-block;background:${brand.accent};color:${brand.accentInk};text-decoration:none;font-weight:600;font-size:13px;padding:10px 22px;border-radius:100px;">📋 Alle Bewerbungen ansehen</a>
  </td></tr>
</table>` : '';

  const sheetHtml = sheetUrl ? `
<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;">
  <tr><td align="center" style="padding:6px 0;">
    <a href="${escape(sheetUrl)}" style="display:inline-block;background:#fafaf8;color:#0a0a0a;text-decoration:none;font-weight:600;font-size:13px;padding:10px 22px;border-radius:100px;border:1px solid #ececea;">📊 Google Sheet</a>
  </td></tr>
</table>` : '';

  const html = `<!doctype html>
<html lang="de"><body style="margin:0;padding:0;background:#f0efed;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#0a0a0a;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0efed;padding:32px 0;"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;max-width:560px;width:100%;">
  <tr><td style="background:${brand.primary};padding:18px 28px;">
    ${brand.logoHtml}
  </td></tr>
  <tr><td style="padding:24px 28px 8px;">
    <p style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9a9994;margin:0 0 8px;">Neue Bewerbung · ${quelle}</p>
    <h1 style="font-size:22px;font-weight:700;letter-spacing:-0.02em;margin:0 0 4px;color:#0a0a0a;">${name}</h1>
    <p style="font-size:13px;color:#5a5955;margin:0 0 6px;">für <strong>${stelle}</strong>${region ? ` · ${region}` : ''}</p>
    ${koWarning}
  </td></tr>
  <tr><td style="padding:6px 28px 8px;">
    <h2 style="font-size:14px;font-weight:700;color:#0a0a0a;margin:14px 0 10px;">Kontakt</h2>
    <table width="100%" cellpadding="0" cellspacing="0">
      ${email ? `<tr><td style="padding:6px 0;font-size:12px;color:#5a5955;width:45%;">E-Mail</td><td style="padding:6px 0;font-size:13px;font-weight:500;"><a href="mailto:${email}" style="color:#0a0a0a;">${email}</a></td></tr>` : ''}
      ${telefon ? `<tr><td style="padding:6px 0;font-size:12px;color:#5a5955;">Telefon</td><td style="padding:6px 0;font-size:13px;font-weight:500;"><a href="tel:${telefon}" style="color:#0a0a0a;">${telefon}</a></td></tr>` : ''}
      ${(!email && !telefon) ? '<tr><td colspan="2" style="font-size:12px;color:#9a9994;font-style:italic;">Keine Kontaktdaten übermittelt.</td></tr>' : ''}
    </table>
    ${antwortenHtml}
    ${bewerbungenButtonHtml}
    ${sheetHtml}
  </td></tr>
  <tr><td style="padding:18px 28px;background:#fafaf8;border-top:1px solid #ececea;text-align:center;">
    <p style="font-size:11px;color:#9a9994;margin:0;">${escape(brand.footer)} · <a href="${brand.websiteUrl}" style="color:#5a5955;text-decoration:none;border-bottom:1px dotted #c0bfba;">${escape(brand.websiteUrl.replace(/^https?:\/\//, ''))}</a></p>
  </td></tr>
</table></td></tr></table></body></html>`;

  const textParts = [
    `Neue Bewerbung für ${job?.stelle || 'die Stelle'}`,
    isKo ? '\n⚠️ KO-Kriterium ausgelöst — Bewerber erfüllt nicht alle Anforderungen.' : '',
    `\nName: ${bewerbung?.name || '—'}`,
    `E-Mail: ${bewerbung?.email || '—'}`,
    `Telefon: ${bewerbung?.telefon || '—'}`,
  ];
  if (antworten.length > 0) {
    textParts.push('\nAntworten:');
    for (const a of antworten) {
      textParts.push(`  ${a.frage_text || '?'}: ${a.antwort || '—'}`);
    }
  }
  if (bewerbungenUrl) textParts.push(`\nAlle Bewerbungen: ${bewerbungenUrl}`);
  if (sheetUrl) textParts.push(`\nGoogle Sheet: ${sheetUrl}`);

  const subjekt = `Neue Bewerbung für ${job?.stelle || 'Stelle'}${bewerbung?.name ? ` — ${bewerbung.name}` : ''}`;
  // BCC: zentrale Empfänger + Jessica nur wenn Job mit telefonischer Vorqual läuft
  const extraBcc = job?.vorqualifizierung ? [VORQUAL_BCC] : [];
  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: getMailFrom(brand),
      to: recipients,
      bcc: getInternalBcc(extraBcc, recipients),
      reply_to: bewerbung?.email || getMailReplyTo(brand),
      subject: subjekt,
      html,
      text: textParts.join('\n'),
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend ${response.status}: ${body.slice(0, 300)}`);
  }
  return await response.json();
}

/* ───────────────────── Mail an Kunden senden ───────────────────── */

function escape(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function sendEntwurfsMail({ to, betreff, anschreiben, job, kunde, creatives, adcopies, funnelUrl, sheetUrl, reviewUrl, avvUrl, variant = 'entwurf' }) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY nicht gesetzt.');
  const istUpdate = variant === 'update';
  // Wortlaut je nach Variante — Entwurfs-Erstversand vs. Kampagnen-Update während der Live-Phase.
  const eyebrow = istUpdate ? 'Kampagnen-Update zur Freigabe' : 'Entwürfe zur Freigabe';
  const reviewHeadline = istUpdate ? 'Neue Anzeigen freigeben?' : 'Bereit für Feedback?';
  const reviewIntro = istUpdate
    ? t(kunde, 'Wir haben neue Werbeanzeigen erstellt, um die Performance weiter zu verbessern. Schau sie dir an und gib sie frei', 'Wir haben neue Werbeanzeigen erstellt, um die Performance weiter zu verbessern. Sehen Sie sie sich an und geben Sie sie frei')
    : t(kunde, 'Du kannst die Entwürfe direkt online kommentieren oder freigeben', 'Sie können die Entwürfe direkt online kommentieren oder freigeben');
  const reviewCta = istUpdate ? 'Ansehen &amp; freigeben →' : 'Entwürfe kommentieren &amp; freigeben →';
  const _tpl = await renderEmail(istUpdate ? 'kampagne_update' : 'entwurf_runde', kunde, { stelle: job?.stelle || '' });
  const betreffFallback = _tpl?.subject || (istUpdate
    ? t(kunde, 'Neue Werbeanzeigen für deine Kampagne 📬', 'Neue Werbeanzeigen für Ihre Kampagne 📬')
    : t(kunde, 'Deine Entwürfe sind fertig 🎨', 'Ihre Entwürfe sind fertig 🎨'));

  const brand = getBranding(kunde?.agentur);
  const safeAnschreiben = escape(anschreiben || '').replace(/\n/g, '<br>');
  const firma = escape(kunde?.firmenname || '');
  const stelle = escape(job?.stelle || '');

  // Sortiere Creatives — Bilder zuerst (1x1 vor 9x16), dann Videos
  const sortedCreatives = [...creatives].sort((a, b) => {
    if (a.typ !== b.typ) return a.typ === 'video' ? 1 : -1;
    if (a.format !== b.format) return a.format === 'quadrat' ? -1 : 1;
    return 0;
  });

  const creativesHtml = sortedCreatives.length === 0 ? '' : `
<h2 style="font-size:16px;font-weight:700;color:#0a0a0a;margin:32px 0 14px;">Creatives</h2>
<table width="100%" cellpadding="0" cellspacing="0">
  ${sortedCreatives.map(c => {
    const badge = c.typ === 'video' ? 'Reel' : (c.format === 'story' ? '9:16 Story' : '1:1 Feed');
    if (c.typ === 'video') {
      return `<tr><td style="padding:8px 0;"><a href="${c.bild_url}" target="_blank" style="display:block;text-decoration:none;color:#0a0a0a;background:#fafaf8;border:1px solid #ececea;border-radius:8px;padding:16px;text-align:center;"><strong>▶ ${badge}</strong><br><span style="font-size:11px;color:#5a5955;">Video ansehen</span></a></td></tr>`;
    }
    return `<tr><td style="padding:8px 0;"><div style="position:relative;"><img src="${c.bild_url}" alt="" width="500" style="max-width:100%;display:block;border-radius:8px;border:1px solid #ececea;"/><div style="font-size:11px;color:#9a9994;padding-top:6px;">${badge}</div></div></td></tr>`;
  }).join('')}
</table>`;

  const styleLabels = {
    emotional: 'Emotional / Story',
    benefit:   'Benefit-fokussiert',
    kompakt:   'Knackig / Hook',
  };
  const sortedAdcopies = ['emotional', 'benefit', 'kompakt']
    .map(s => adcopies.find(a => a.stil === s))
    .filter(Boolean);

  const adcopiesHtml = sortedAdcopies.length === 0 ? '' : `
<h2 style="font-size:16px;font-weight:700;color:#0a0a0a;margin:32px 0 14px;">Werbetexte</h2>
${sortedAdcopies.map(a => `
<div style="margin:0 0 18px;padding:16px;background:#fafaf8;border:1px solid #ececea;border-radius:8px;">
  <div style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#5a5955;margin-bottom:8px;">${escape(styleLabels[a.stil] || a.stil)}</div>
  <div style="font-size:13px;line-height:1.55;color:#2a2a2a;white-space:pre-wrap;">${escape(a.text || '')}</div>
</div>
`).join('')}`;

  const funnelHtml = funnelUrl ? `
<h2 style="font-size:16px;font-weight:700;color:#0a0a0a;margin:32px 0 14px;">Bewerbungs-Funnel</h2>
<table width="100%" cellpadding="0" cellspacing="0">
  <tr><td align="center" style="padding:8px 0;">
    <a href="${escape(funnelUrl)}" style="display:inline-block;background:${brand.accent};color:${brand.accentInk};text-decoration:none;font-weight:700;font-size:14px;padding:14px 28px;border-radius:100px;">→ Funnel-Vorschau ansehen</a>
    <div style="font-size:11px;color:#9a9994;margin-top:8px;">${escape(funnelUrl)}</div>
  </td></tr>
</table>` : '';

  const sheetHtml = sheetUrl ? `
<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
  <tr><td align="center" style="padding:8px 0;">
    <a href="${escape(sheetUrl)}" style="display:inline-block;background:#fafaf8;color:#0a0a0a;text-decoration:none;font-weight:600;font-size:13px;padding:10px 22px;border-radius:100px;border:1px solid #ececea;">📊 Google Sheet öffnen</a>
  </td></tr>
</table>` : '';

  const reviewHtml = reviewUrl ? `
<div style="margin:32px 0 8px;padding:24px;background:${brand.accent}1a;border:1px solid #ececea;border-radius:14px;text-align:center;">
  <h2 style="font-size:17px;font-weight:700;color:${brand.primary};margin:0 0 6px;">${reviewHeadline}</h2>
  <p style="font-size:13px;color:#5a5955;margin:0 0 16px;line-height:1.55;">${reviewIntro} — alles in einer Übersicht.</p>
  <a href="${escape(reviewUrl)}" style="display:inline-block;background:${brand.accent};color:${brand.accentInk};text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:100px;">${reviewCta}</a>
</div>` : '';

  const html = `<!doctype html>
<html lang="de"><body style="margin:0;padding:0;background:#f0efed;font-family:-apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif;color:#0a0a0a;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0efed;padding:32px 0;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;max-width:600px;width:100%;">
  <tr><td style="background:${brand.primary};padding:22px 32px;">
    ${brand.logoHtml}
    ${kunde?.logo_url ? `<img src="${escape(kunde.logo_url)}" alt="${firma}" style="height:36px;float:right;background:#fff;border-radius:6px;padding:4px;">` : ''}
  </td></tr>
  <tr><td style="padding:28px 32px 8px;">
    <h1 style="font-size:22px;font-weight:700;letter-spacing:-0.02em;margin:0 0 6px;color:#0a0a0a;">${stelle}${stelle && firma ? ' · ' : ''}${firma}</h1>
    <p style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9a9994;margin:0 0 22px;">${eyebrow}</p>
    <p style="font-size:14px;line-height:1.6;color:#2a2a2a;margin:0 0 8px;">${safeAnschreiben}</p>
  </td></tr>
  <tr><td style="padding:0 32px 24px;">
    ${reviewHtml}
    ${creativesHtml}
    ${adcopiesHtml}
    ${funnelHtml}
    ${sheetHtml}
    ${avvUrl ? `
    <p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:#5a5955;">📄 Nebenbei: Der Auftragsverarbeitungsvertrag ist noch offen — ${t(kunde, 'du kannst ihn direkt auf der Freigabe-Seite oder', 'Sie können ihn direkt auf der Freigabe-Seite oder')} <a href="${escape(avvUrl)}" style="color:${brand.primary};font-weight:600;">hier ansehen &amp; akzeptieren</a>.</p>` : ''}
  </td></tr>
  <tr><td style="padding:20px 32px;background:#fafaf8;border-top:1px solid #ececea;">
    <p style="font-size:13px;line-height:1.6;color:#5a5955;margin:0;">${t(kunde, 'Bei Änderungswünschen kannst du direkt im', 'Bei Änderungswünschen können Sie direkt im')} <a href="${escape(reviewUrl || '#')}" style="color:${brand.primary};">Review-Tool</a> ${t(kunde, 'kommentieren oder einfach auf diese Mail antworten.', 'kommentieren oder einfach auf diese Mail antworten.')}</p>
  </td></tr>
  <tr><td style="padding:14px 32px;background:#fafaf8;text-align:center;">
    <p style="font-size:11px;color:#9a9994;margin:0;">${escape(brand.footer)} · <a href="${brand.websiteUrl}" style="color:#5a5955;text-decoration:none;border-bottom:1px dotted #c0bfba;">${escape(brand.websiteUrl.replace(/^https?:\/\//, ''))}</a></p>
  </td></tr>
</table></td></tr></table></body></html>`;

  const textParts = [anschreiben || ''];
  if (reviewUrl) textParts.push(`\n→ ${istUpdate ? 'Neue Anzeigen ansehen & freigeben' : 'Entwürfe kommentieren & freigeben'}: ${reviewUrl}`);
  if (sortedCreatives.length) textParts.push(`\n${sortedCreatives.length} Creative(s) im Anhang/eingebettet.`);
  if (sortedAdcopies.length) {
    textParts.push('\nWerbetexte:');
    for (const a of sortedAdcopies) {
      textParts.push(`\n— ${styleLabels[a.stil]} —\n${a.text}\n`);
    }
  }
  if (funnelUrl) textParts.push(`\nFunnel-Vorschau: ${funnelUrl}`);
  if (sheetUrl) textParts.push(`Google Sheet: ${sheetUrl}`);
  if (avvUrl) textParts.push(`\n📄 Bitte noch bestätigen — AVV ansehen & akzeptieren: ${avvUrl}`);

  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: getMailFrom(brand),
      to,
      bcc: getInternalBcc([], Array.isArray(to) ? to : [to]),
      reply_to: getMailReplyTo(brand),
      subject: betreff || betreffFallback,
      html,
      text: textParts.join('\n'),
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend ${response.status}: ${body.slice(0, 300)}`);
  }
  return await response.json();
}
