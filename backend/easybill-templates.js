// Zentrale Konfiguration: easybill-PDF-Vorlagen je Marke und Dokument-Typ.
//
// Zuweisung erfolgt beim Erstellen des Dokuments über das Feld `pdf_template`
// am Document (Wert = die numerische Template-ID als String oder 'DE'/'EN'
// für die Defaults). API-Discovery: GET /pdf-templates?type=<TYPE>.
//
// Die konkreten IDs sind in easybill unter Vorlagen zu finden (Vorlagenname
// gemappt auf die id/pdf_template-Property des Template-Objekts).
// Konfigurierbar über Env, damit Umbenennungen/Anlage neuer Vorlagen keinen
// Redeploy erfordern.

// Doc-Typ-Namen entsprechen den easybill-Enum-Werten am Document.
// 'ORDER_CONFIRM' → alias für CHARGE_CONFIRM (Auftragsbestätigung).
const TYPE_ALIAS = {
  ORDER_CONFIRM: 'CHARGE_CONFIRM',
};

// Env-Fallbacks je (brand, easybill-doc-type). null = easybill-Default nutzen.
const DEFAULTS = {
  talentone: {
    // TalentOne-Layout mit hinterlegtem Briefpapier
    OFFER:          process.env.EASYBILL_OFFER_TEMPLATE_TALENTONE    || '433187',
    CHARGE_CONFIRM: process.env.EASYBILL_ORDER_TEMPLATE_TALENTONE    || '433190',
    INVOICE:        process.env.EASYBILL_INVOICE_TEMPLATE_TALENTONE  || '433193',
  },
  nowag_wirth: {
    // N&W: bestehendes "Mit Menge und Einzelpreis"-Layout (Standardlayout für N&W)
    OFFER:          process.env.EASYBILL_OFFER_TEMPLATE_NOWAG_WIRTH    || '305416',
    CHARGE_CONFIRM: process.env.EASYBILL_ORDER_TEMPLATE_NOWAG_WIRTH    || '311713',
    INVOICE:        process.env.EASYBILL_INVOICE_TEMPLATE_NOWAG_WIRTH  || '311656',
  },
};

/**
 * @param {'talentone'|'nowag_wirth'} brand
 * @param {'OFFER'|'INVOICE'|'CHARGE_CONFIRM'|'ORDER_CONFIRM'} docType
 * @returns {string|null} pdf_template-Wert für POST /documents, oder null (= easybill-Default 'DE').
 */
export function getPdfTemplate(brand, docType) {
  if (!brand || !docType) return null;
  const resolvedType = TYPE_ALIAS[docType] || docType;
  const byBrand = DEFAULTS[brand];
  if (!byBrand) return null;
  const val = byBrand[resolvedType];
  return val || null;
}

/** Kompletter Snapshot für Debug/Config-Check-Endpoint. */
export function getPdfTemplateConfig() {
  return {
    talentone:   { ...DEFAULTS.talentone },
    nowag_wirth: { ...DEFAULTS.nowag_wirth },
    note: 'CHARGE_CONFIRM = Auftragsbestätigung in easybill.',
  };
}
