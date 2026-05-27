// Frontend-Mirror der backend/branding.js.
// Wird verwendet, um Kunden-Links + Branding auf Public-Seiten korrekt zu generieren.

const TALENTONE_DOMAIN  = import.meta.env.VITE_TALENTONE_DOMAIN  || 'inside.talent-one.de';
const NOWAGWIRTH_DOMAIN = import.meta.env.VITE_NOWAGWIRTH_DOMAIN || 'recruiting.nowagwirth.com';

export const BRANDS = {
  talentone: {
    key: 'talentone',
    name: 'TalentOne',
    domain: TALENTONE_DOMAIN,
    websiteUrl: 'https://talent-one.de',
    primary: '#0a0a0a',
    accent: '#d4ff00',
    accentInk: '#0a0a0a',
    footer: 'TalentOne — Recruiting neu gedacht',
    madeWith: 'Made with ♥ by TalentOne',
    logoUrl: null,
  },
  nowagwirth: {
    key: 'nowagwirth',
    name: 'Nowag & Wirth',
    domain: NOWAGWIRTH_DOMAIN,
    websiteUrl: 'https://nowagwirth.com',
    primary: '#0a0a0a',
    accent: '#980000',
    accentInk: '#ffffff',
    footer: 'Nowag & Wirth — Digitales Marketing',
    madeWith: 'Made with ♥ by Nowag & Wirth',
    logoUrl: '/nowagwirth-logo.png',
  },
};

export function getBrand(agentur) {
  return BRANDS[agentur] || BRANDS.talentone;
}

// Liefert die Basis-URL für Kunden-Links (Funnel, Bewerberliste, Review, Upload, Formular).
// Im lokalen Dev (localhost) immer aktuelle Origin, sonst Brand-Domain.
export function getBrandBaseUrl(agentur) {
  if (typeof window !== 'undefined' && /^localhost(:|$)/.test(window.location.host)) {
    return window.location.origin;
  }
  const brand = getBrand(agentur);
  return `https://${brand.domain}`;
}

// Die Backend-Origin für API-Calls (Webhook-URL). Immer inside.talent-one.de in Prod.
export function getApiBaseUrl() {
  if (typeof window !== 'undefined' && /^localhost(:|$)/.test(window.location.host)) {
    return window.location.origin;
  }
  return `https://${TALENTONE_DOMAIN}`;
}
