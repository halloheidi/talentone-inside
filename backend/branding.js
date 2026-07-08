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
    firma: 'TalentOne (Nowag & Wirth GmbH & Co. KG)',
    adresse: { strasse: 'Bäckerstr. 2', plz: '40213', ort: 'Düsseldorf', land: 'DE' },
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
    calBeratungsUrl: 'https://cal.com/talent-one/kostenloses-beratungsgesprach',
    calReaktivierungUrl: 'https://calendly.com/andrea-saltaleggio/drafts',
    // Logo
    logoHtml: '<span style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:-0.02em;">Talent<span style="color:#d4ff00;">One</span></span>',
    logoUrl: null,
  },
  nowagwirth: {
    key: 'nowagwirth',
    name: 'Nowag & Wirth',
    firma: 'Nowag & Wirth GmbH & Co. KG',
    adresse: { strasse: 'Bäckerstr. 2', plz: '40213', ort: 'Düsseldorf', land: 'DE' },
    domain: NOWAGWIRTH_DOMAIN,
    websiteUrl: 'https://nowagwirth.com',
    // Mail (Domain in Resend verifiziert: nowagwirth.com)
    from: 'Nowag & Wirth <noreply@nowagwirth.com>',
    replyTo: 'info@nowagwirth.de',
    mailVerified: NOWAGWIRTH_MAIL_VERIFIED,
    // Farben (Weiß / Rot / Schwarz)
    primary: '#0a0a0a',
    accent: '#980000',
    accentInk: '#ffffff',
    // Texte
    footer: 'Nowag & Wirth — Digitales Marketing',
    madeWith: 'Made with ♥ by Nowag & Wirth',
    calBeratungsUrl: 'https://calendly.com/andrea-saltaleggio/drafts',
    calReaktivierungUrl: 'https://calendly.com/andrea-saltaleggio/drafts',
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

// Absender speziell für Angebote (Phase 4b): angebote@ statt noreply@.
// User hat bestätigt, dass beide Domains in Resend verifiziert sind —
// daher hier KEIN Fallback-Weg über TalentOne, sondern immer marken-native.
// Reply-To für Angebote einheitlich: info@nowagwirth.de.
export function getOfferMailFrom(brand) {
  if (brand.key === 'nowagwirth') return 'Nowag & Wirth <angebote@nowagwirth.com>';
  return 'TalentOne <angebote@talent-one.de>';
}
export function getOfferMailReplyTo(brand) {
  return 'info@nowagwirth.de';
}

// Offer-Marken-Schlüssel (talentone | nowag_wirth) → Agentur-Schlüssel für
// branding.js (talentone | nowagwirth). Wird von der Angebots-Mail-Route
// gebraucht, weil offer.brand ein anderes Naming nutzt.
export function agenturForOfferBrand(offerBrand) {
  return offerBrand === 'nowag_wirth' ? 'nowagwirth' : 'talentone';
}

export { BRANDING };
