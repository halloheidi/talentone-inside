// easybill REST API — Kunden + Rechnungen
// https://www.easybill.de/api/

const EASYBILL_BASE = process.env.EASYBILL_BASE_URL || 'https://api.easybill.de/rest/v1';

function authHeaders() {
  const key = process.env.EASYBILL_API_KEY;
  if (!key) throw new Error('EASYBILL_API_KEY nicht gesetzt.');
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function easybill(path, { method = 'GET', body, raw = false } = {}) {
  const res = await fetch(`${EASYBILL_BASE}${path}`, {
    method,
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) {
    if (!res.ok) throw new Error(`easybill ${method} ${path}: HTTP ${res.status}`);
    return res; // Caller liest binary
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* leer */ }
  if (!res.ok) {
    const msg = json?.message || json?.error?.message || text.slice(0, 300);
    throw new Error(`easybill ${method} ${path} ${res.status}: ${msg}`);
  }
  return json || {};
}

/**
 * Sucht einen Kunden nach Firmenname (exact match). Bei mehreren Treffern: ersten nehmen.
 */
export async function findCustomer({ firmenname }) {
  if (!firmenname) return null;
  const data = await easybill(`/customers?company_name=${encodeURIComponent(firmenname)}&limit=5`);
  const items = data?.items || data?.data || [];
  return items.find(c => (c.company_name || '').trim().toLowerCase() === firmenname.trim().toLowerCase()) || items[0] || null;
}

/**
 * Listet Kunden mit Pagination (für den Bulk-Sync in den lokalen Cache).
 * @param {object} opts
 * @param {number} [opts.page=1]
 * @param {number} [opts.limit=1000]  Max 1000 laut easybill-Doku.
 * @returns {Promise<{ page:number, pages:number, limit:number, total:number, items:Array }>}
 */
export async function listCustomers({ page = 1, limit = 1000 } = {}) {
  const qs = new URLSearchParams({ page: String(page), limit: String(limit) }).toString();
  const data = await easybill(`/customers?${qs}`);
  return {
    page:  Number(data?.page || page),
    pages: Number(data?.pages || 1),
    limit: Number(data?.limit || limit),
    total: Number(data?.total || 0),
    items: Array.isArray(data?.items) ? data.items : [],
  };
}

/** Holt einen einzelnen Kunden per ID. */
export async function getCustomer(id) {
  if (!id) throw new Error('customer id fehlt.');
  return easybill(`/customers/${encodeURIComponent(id)}`);
}

/**
 * Aktualisiert einen Kunden in easybill (führendes System).
 * Erwartet die easybill-Property-Namen (company_name, first_name, …).
 */
export async function updateCustomer(id, patch) {
  if (!id) throw new Error('customer id fehlt.');
  return easybill(`/customers/${encodeURIComponent(id)}`, { method: 'PUT', body: patch });
}

/**
 * Legt einen neuen Kunden an.
 * @param {object} opts { firmenname, ansprechpartner, email, telefon, strasse, plz, ort, land, ust_id }
 */
export async function createCustomer({ firmenname, ansprechpartner, email, telefon, strasse, plz, ort, land = 'DE', ust_id }) {
  const body = {
    company_name: firmenname || null,
    first_name: ansprechpartner ? ansprechpartner.split(/\s+/)[0] : null,
    last_name: ansprechpartner ? ansprechpartner.split(/\s+/).slice(1).join(' ') || null : null,
    emails: email ? [email] : [],
    phone_1: telefon || null,
    street: strasse || null,
    zip_code: plz || null,
    city: ort || null,
    country: land,
    vat_identifier: ust_id || null,
  };
  return easybill('/customers', { method: 'POST', body });
}

export async function findOrCreateCustomer(opts) {
  const existing = await findCustomer({ firmenname: opts.firmenname });
  if (existing?.id) return existing;
  return createCustomer(opts);
}

/**
 * Erstellt eine Rechnung. Bei status='done' wird sie direkt finalisiert.
 *
 * @param {object} opts
 * @param {number} opts.customerId
 * @param {string} opts.beschreibung
 * @param {number} opts.nettoCent
 * @param {number} opts.steuerProzent       19 oder 0
 * @param {boolean} opts.kleinunternehmer
 * @param {string} [opts.leistungszeitraum] z.B. "Juni 2026"
 * @param {string} [opts.paidAtIso]         z.B. "2026-06-15T12:00:00Z"
 * @param {object} [opts.absender]          brand-info { firma, adresse, ... }
 */
export async function createInvoice({
  customerId, beschreibung, nettoCent, steuerProzent = 19,
  kleinunternehmer = false, leistungszeitraum, paidAtIso, externalReference,
}) {
  const nettoEur = (nettoCent / 100).toFixed(2);
  const document = {
    type: 'INVOICE',
    customer_id: customerId,
    title: 'Rechnung',
    service_date: leistungszeitraum || null,
    items: [{
      description: (beschreibung || 'Werbebudget').slice(0, 240),
      quantity: 1,
      unit: 'Stk.',
      single_price_net: parseFloat(nettoEur),
      vat_percent: kleinunternehmer ? 0 : steuerProzent,
    }],
    payment_options: 'paypal',
    text: kleinunternehmer ? 'Gemäß §19 UStG wird keine Umsatzsteuer berechnet.' : null,
    external_id: externalReference || null,
  };
  if (paidAtIso) {
    document.is_paid = true;
    document.paid_at = paidAtIso.slice(0, 10);
  }
  return easybill('/documents', { method: 'POST', body: document });
}

/** Finalisiert eine Rechnung (DRAFT → DONE). */
export async function finalizeInvoice(documentId) {
  return easybill(`/documents/${encodeURIComponent(documentId)}/done`, { method: 'PUT' });
}

/** Liefert PDF einer Rechnung als Buffer. */
export async function getInvoicePdf(documentId) {
  const res = await fetch(`${EASYBILL_BASE}/documents/${encodeURIComponent(documentId)}/pdf`, {
    headers: { Authorization: `Bearer ${process.env.EASYBILL_API_KEY}`, Accept: 'application/pdf' },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`easybill PDF ${res.status}: ${body.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Holt nur die Metadaten (z.B. Rechnungsnummer). */
export async function getInvoice(documentId) {
  return easybill(`/documents/${encodeURIComponent(documentId)}`);
}

/** Alias für Klarheit — der PDF-Endpunkt /documents/{id}/pdf gilt für alle
 *  Dokumenttypen (Rechnung, Angebot, ...). */
export const getDocumentPdf = getInvoicePdf;

/** Holt Metadaten eines beliebigen Dokuments. */
export async function getDocument(documentId) {
  return easybill(`/documents/${encodeURIComponent(documentId)}`);
}

/**
 * Erstellt ein Angebot (type: OFFER) in easybill.
 *
 * @param {object} opts
 * @param {number} opts.customerId       easybill-customer_id
 * @param {string} [opts.title]          Dokumenttitel (default 'Angebot')
 * @param {Array}  opts.items            DocumentPosition-Array (siehe offer-easybill-builder.js)
 * @param {string} [opts.text]           Freitext am Dokument-Ende (optional; wir nutzen TEXT-Positionen)
 * @param {string|null} [opts.pdfTemplate] pdf_template-ID (null = Default 'DE')
 * @param {string} [opts.externalId]     Referenz für den easybill_document_id-Rücksync
 * @param {number} [opts.vatPercent]     19 (bereits pro Position gesetzt — hier ungenutzt)
 * @returns {Promise<object>}            Das erzeugte Document-Objekt inkl. id
 */
export async function createOffer({
  customerId, title = 'Angebot', items = [], text = null,
  pdfTemplate = null, externalId = null,
}) {
  const body = {
    type: 'OFFER',
    customer_id: customerId,
    title,
    items,
  };
  if (text !== null && text !== '') body.text = text;
  if (pdfTemplate)                   body.pdf_template = pdfTemplate;
  if (externalId)                    body.external_id = externalId;
  return easybill('/documents', { method: 'POST', body });
}

/**
 * Listet PDF-Templates aus easybill — hilft der Admin-UI bei der Wahl der
 * marken-spezifischen Template-ID.
 * @param {string} [type='OFFER'] — dokumenttyp-Filter.
 */
export async function listPdfTemplates(type = 'OFFER') {
  const qs = new URLSearchParams({ type }).toString();
  const data = await easybill(`/pdf-templates?${qs}`);
  return Array.isArray(data?.items) ? data.items : [];
}
