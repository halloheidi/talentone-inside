// Zentrales Branding für White-Label.
// Bestimmt Domain, Mail-Konfiguration, Farben, Footer, Logo je Agentur.

const TALENTONE_DOMAIN = process.env.TALENTONE_DOMAIN || 'inside.talent-one.de';
const NOWAGWIRTH_DOMAIN = process.env.NOWAGWIRTH_DOMAIN || 'recruiting.nowagwirth.com';

// Mitteilung an Resend: wenn nowagwirth.com noch nicht verifiziert, Fallback auf talent-one.de
const NOWAGWIRTH_MAIL_VERIFIED = process.env.NOWAGWIRTH_MAIL_VERIFIED === '1';

// Fallback-Absender (immer verifiziert)
const FALLBACK_FROM = 'TalentOne <noreply@talent-one.de>';

const BRANDING = {
  talentone: {
    key: 'talentone',
    name: 'TalentOne',
    domain: TALENTONE_DOMAIN,
    websiteUrl: 'https://talent-one.de',
    // Mail
    from: 'TalentOne <noreply@talent-one.de>',
    replyTo: 'info@nowagwirth.de',
    mailVerified: true,
    // Farben
    primary: '#0a0a0a',
    accent: '#d4ff00',
    accentInk: '#0a0a0a',
    // Texte
    footer: 'TalentOne — Recruiting neu gedacht',
    madeWith: 'Made with ♥ by TalentOne',
    // Logo
    logoHtml: '<span style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:-0.02em;">Talent<span style="color:#d4ff00;">One</span></span>',
    logoUrl: null,
  },
  nowagwirth: {
    key: 'nowagwirth',
    name: 'Nowag & Wirth',
    domain: NOWAGWIRTH_DOMAIN,
    websiteUrl: 'https://nowagwirth.com',
    // Mail (Domain in Resend verifiziert: nowagwirth.com)
    from: 'Nowag & Wirth <noreply@nowagwirth.com>',
    replyTo: 'info@nowagwirth.com',
    mailVerified: NOWAGWIRTH_MAIL_VERIFIED,
    // Farben
    primary: '#1a3a6c',
    accent: '#ffd966',
    accentInk: '#1a3a6c',
    // Texte
    footer: 'Nowag & Wirth — Digitales Marketing',
    madeWith: 'Made with ♥ by Nowag & Wirth',
    // Logo
    logoHtml: '__LOGO_PLACEHOLDER__', // wird dynamisch ersetzt
    logoUrl: null,
  },
};

// Logo-HTML setzen, sobald Domain bekannt
function buildNowagwirthLogoHtml(brand) {
  return `<img src="https://${brand.domain}/nowagwirth-logo.png" alt="Nowag &amp; Wirth" height="36" style="display:inline-block;background:#fff;border-radius:6px;padding:4px 8px;">`;
}

export function getBranding(agentur) {
  const brand = BRANDING[agentur] || BRANDING.talentone;
  // Lazy Logo-Generierung für Nowag & Wirth (Domain kann env-overridden sein)
  if (brand.key === 'nowagwirth' && brand.logoHtml === '__LOGO_PLACEHOLDER__') {
    brand.logoHtml = buildNowagwirthLogoHtml(brand);
  }
  return brand;
}

// Liefert die Public-Base-URL (https://<domain>) für eine Agentur.
export function getPublicBaseUrl(agentur) {
  const brand = getBranding(agentur);
  return `https://${brand.domain}`;
}

// Liefert die korrekte Resend-From-Adresse. Wenn die Mail-Domain der Agentur
// noch nicht verifiziert ist (z.B. nowagwirth.de in Resend), Fallback auf
// TalentOne als Absender + brand.replyTo als Reply-To.
export function getMailFrom(brand) {
  if (brand.mailVerified) return brand.from;
  return FALLBACK_FROM;
}

// Reply-To bleibt immer die brand-eigene Adresse, damit Antworten richtig landen.
export function getMailReplyTo(brand) {
  return brand.replyTo;
}

export { BRANDING };
