// PayPal Live REST API — OAuth2 + Invoicing
// https://developer.paypal.com/docs/api/invoicing/v2/

const PAYPAL_BASE = process.env.PAYPAL_BASE_URL || 'https://api-m.paypal.com';

let cachedToken = null;
let cachedTokenExpires = 0;

async function getAccessToken() {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error('PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET nicht gesetzt.');

  // Cache: Token ist 9h gültig — neuen Token holen wenn <5 min Rest
  const now = Date.now();
  if (cachedToken && cachedTokenExpires - now > 5 * 60 * 1000) return cachedToken;

  const auth = Buffer.from(`${id}:${secret}`).toString('base64');
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PayPal OAuth fehlgeschlagen ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  cachedToken = data.access_token;
  cachedTokenExpires = now + (data.expires_in || 3600) * 1000;
  return cachedToken;
}

async function paypalFetch(path, { method = 'GET', body } = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${PAYPAL_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* maybe empty */ }
  if (!res.ok) {
    const msg = json?.message || json?.details?.[0]?.description || text.slice(0, 300);
    throw new Error(`PayPal ${method} ${path} ${res.status}: ${msg}`);
  }
  return json || {};
}

function centsToAmount(cent) {
  return { currency_code: 'EUR', value: (cent / 100).toFixed(2) };
}

/**
 * Erzeugt eine Invoice (Draft) und „sendet" sie via SEND mit send_to_recipient=false,
 * damit PayPal selbst keine Mail rausschickt — wir versenden den Link in unserer
 * eigenen brand-gerechten Mail.
 *
 * Liefert: { id, invoice_number, pay_link, detail }
 */
export async function createInvoice({
  amountCent,
  description,
  invoiceNumber,
  faelligkeit,
  customerEmail,
  customerName,
  noteToRecipient,
}) {
  if (!amountCent || amountCent < 100) throw new Error('Betrag muss ≥ 1,00 € sein.');

  const body = {
    detail: {
      currency_code: 'EUR',
      invoice_number: invoiceNumber || undefined,
      invoice_date: new Date().toISOString().slice(0, 10),
      payment_term: faelligkeit
        ? { due_date: faelligkeit }
        : { term_type: 'NO_DUE_DATE' },
      note: description || 'Werbebudget',
      ...(noteToRecipient ? { memo: noteToRecipient } : {}),
    },
    invoicer: {
      // Aus dem Default-Profil des Verkäufer-Accounts — kann auch im PayPal-Dashboard hinterlegt sein
    },
    primary_recipients: customerEmail ? [
      {
        billing_info: {
          email_address: customerEmail,
          ...(customerName ? { business_name: customerName } : {}),
        },
      },
    ] : [],
    items: [
      {
        name: description?.slice(0, 100) || 'Werbebudget',
        quantity: '1',
        unit_amount: centsToAmount(amountCent),
      },
    ],
    configuration: {
      partial_payment: { allow_partial_payment: false },
      allow_tip: false,
      tax_calculated_after_discount: true,
      tax_inclusive: false,
    },
  };

  // Schritt 1: Draft anlegen
  const created = await paypalFetch('/v2/invoicing/invoices', { method: 'POST', body });
  const invoiceId = created.id || created.href?.split('/').pop();
  if (!invoiceId) throw new Error('PayPal hat keine invoice_id zurückgegeben.');

  // Schritt 2: Senden — aber PayPal soll KEINE eigene Mail versenden,
  // wir versenden brand-eigene Mail mit dem Link.
  await paypalFetch(`/v2/invoicing/invoices/${invoiceId}/send`, {
    method: 'POST',
    body: { send_to_recipient: false, send_to_invoicer: false },
  });

  // Schritt 3: Volldatensatz inkl. Pay-Link laden
  const detail = await paypalFetch(`/v2/invoicing/invoices/${invoiceId}`);
  const payLink = detail?.metadata?.recipient_view_url
    || `https://www.paypal.com/invoice/p/#${invoiceId}`;

  return {
    id: invoiceId,
    invoice_number: detail?.detail?.invoice_number || null,
    pay_link: payLink,
    detail,
  };
}

/** Holt einen Invoice-Status frisch von PayPal. */
export async function fetchInvoice(invoiceId) {
  if (!invoiceId) throw new Error('invoiceId fehlt.');
  return paypalFetch(`/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`);
}

/**
 * Normalisiert PayPal-Status auf unser Schema: 'entwurf' | 'offen' | 'bezahlt' | 'ueberfaellig' | 'storniert'.
 */
export function mapStatus(paypalStatus) {
  const s = (paypalStatus || '').toUpperCase();
  if (['DRAFT'].includes(s)) return 'entwurf';
  if (['PAID', 'MARKED_AS_PAID'].includes(s)) return 'bezahlt';
  if (['CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(s)) return 'storniert';
  if (['SENT', 'UNPAID', 'SCHEDULED', 'PARTIALLY_PAID'].includes(s)) return 'offen';
  return 'offen';
}
