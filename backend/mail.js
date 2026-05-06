// Mail-Versand via Resend für TalentOne Inside.

const RESEND_API = 'https://api.resend.com/emails';
const FROM = 'TalentOne Inside <hallo@talent-one.de>';

export async function sendUploadAnfrage({ to, kundenname, ansprechpartner, uploadUrl, customText }) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY nicht gesetzt.');
  }

  const grußname = ansprechpartner || 'zusammen';
  const intro = (customText || '').trim() || `wir bereiten gerade eure Recruiting-Kampagne vor und brauchen dafür ein paar Materialien von euch. Über den unten stehenden Link könnt ihr ganz einfach euer Logo und Fotos vom Team / Arbeitsplatz hochladen.`;

  const html = `<!doctype html>
<html lang="de">
<body style="margin:0;padding:0;background:#f0efed;font-family:-apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif;color:#0a0a0a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0efed;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;max-width:600px;width:100%;">
        <tr><td style="background:#0a0a0a;padding:24px 32px;">
          <span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.02em;">
            Talent<span style="color:#d4ff00;">One</span>
          </span>
        </td></tr>
        <tr><td style="padding:28px 32px 8px;">
          <p style="font-size:15px;line-height:1.55;color:#0a0a0a;margin:0 0 14px;">Hallo ${escape(grußname)},</p>
          <p style="font-size:15px;line-height:1.6;color:#2a2a2a;margin:0 0 18px;">${escape(intro).replace(/\n/g, '<br>')}</p>
          <p style="font-size:14px;line-height:1.6;color:#2a2a2a;margin:0 0 22px;">
            Was wir uns wünschen würden:
          </p>
          <ul style="font-size:14px;line-height:1.7;color:#2a2a2a;margin:0 0 24px;padding-left:18px;">
            <li><strong>Euer Logo</strong> in guter Qualität (PNG, JPG, SVG)</li>
            <li><strong>3–5 Fotos vom Arbeitsplatz, Team oder typische Tätigkeiten</strong> — gerne auch Handy-Schnappschüsse</li>
          </ul>
        </td></tr>
        <tr><td align="center" style="padding:0 32px 28px;">
          <a href="${uploadUrl}" style="display:inline-block;background:#0a0a0a;color:#d4ff00;text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:100px;letter-spacing:0.02em;">
            → Dateien hochladen
          </a>
          <p style="font-size:11px;color:#9a9994;margin:14px 0 0;">Der Link ist persönlich und nur für ${escape(kundenname)} gültig.</p>
        </td></tr>
        <tr><td style="padding:0 32px 32px;border-top:1px solid #ececea;padding-top:18px;">
          <p style="font-size:13px;line-height:1.6;color:#5a5955;margin:0;">
            Falls etwas unklar ist, einfach auf diese Mail antworten — wir helfen gern.<br>
            Vielen Dank im Voraus!
          </p>
          <p style="font-size:13px;line-height:1.6;color:#0a0a0a;margin:14px 0 0;font-weight:600;">Euer TalentOne-Team</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = `Hallo ${grußname},\n\n${intro}\n\nWas wir uns wünschen:\n• Euer Logo (PNG/JPG/SVG)\n• 3-5 Fotos vom Arbeitsplatz, Team oder typischen Tätigkeiten\n\nUpload-Link: ${uploadUrl}\n\n(Der Link ist persönlich und nur für ${kundenname} gültig.)\n\nVielen Dank!\nEuer TalentOne-Team`;

  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: FROM,
      to,
      reply_to: 'hallo@talent-one.de',
      subject: `Wir brauchen noch Logo und Fotos für eure Kampagne`,
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

function escape(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
