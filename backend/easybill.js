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
