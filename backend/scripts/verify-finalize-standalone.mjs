#!/usr/bin/env node
// Nachweis-Skript: erzeugt eine Standalone-Werbekosten-Testrechnung über
// den regulären invoice-service-Weg, verifiziert dass das Doc finalisiert
// ist (Rechnungsnummer vergeben, kein „Entwurf"-Wasserzeichen), schreibt
// das PDF nach /tmp und markiert die Row als 'cancelled' + storniert das
// easybill-Doc anschließend, damit kein Buchhaltungs-Rest bleibt.
//
// Usage:
//   docker exec -e TEST_EASYBILL_CUSTOMER_ID=<id> talentone-inside-backend \
//     node /app/scripts/verify-finalize-standalone.mjs

import { supabase } from '../supabase.js';
import { createStandaloneAdBudgetInvoice } from '../invoice-service.js';
import { getDocument } from '../easybill.js';
import fs from 'node:fs/promises';

const EASYBILL_BASE = process.env.EASYBILL_BASE_URL || 'https://api.easybill.de/rest/v1';

const CUSTOMER_ID = process.env.TEST_EASYBILL_CUSTOMER_ID
  || (await pickFirstCustomer());
if (!CUSTOMER_ID) {
  console.error('Kein easybill_customer_id verfügbar — bitte TEST_EASYBILL_CUSTOMER_ID setzen.');
  process.exit(1);
}

async function pickFirstCustomer() {
  const { data } = await supabase.from('talentone_easybill_customers')
    .select('easybill_id').limit(1);
  return data?.[0]?.easybill_id || null;
}

async function fetchPdfDirect(docId) {
  const res = await fetch(`${EASYBILL_BASE}/documents/${encodeURIComponent(docId)}/pdf`, {
    headers: { Authorization: `Bearer ${process.env.EASYBILL_API_KEY}`, Accept: 'application/pdf' },
  });
  if (!res.ok) throw new Error(`easybill PDF ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

console.log(`[nachweis] Erzeuge Testrechnung für easybill_customer_id=${CUSTOMER_ID}…`);

const result = await createStandaloneAdBudgetInvoice({
  easybill_customer_id: String(CUSTOMER_ID),
  brand:                'talentone',
  amount_net:           300,           // Minimum
  period_label:         'TESTLAUF — Finalisierungs-Nachweis',
  use_paypal:           false,
  customer_id:          null,
  createdBy:            'verify-finalize-standalone.mjs',
});
const { invoice, doc } = result;
console.log(`[nachweis] Row angelegt: ${invoice.id}`);
console.log(`[nachweis] easybill_document_id=${invoice.easybill_document_id}`);
console.log(`[nachweis] Rechnungsnummer aus DB: ${invoice.easybill_invoice_number || '(leer)'}`);
console.log(`[nachweis] Rechnungsnummer aus easybill-Doc: ${doc?.number || '(leer)'}`);

const check = await getDocument(invoice.easybill_document_id);
console.log(`[nachweis] Re-Check easybill /documents/${invoice.easybill_document_id}: number=${check.number}, document_type=${check.document_type ?? '-'}`);
if (!check.number) {
  console.error('❌ FAIL: Doc hat keine Rechnungsnummer — nicht finalisiert!');
  process.exit(2);
}

const pdf = await fetchPdfDirect(invoice.easybill_document_id);
const path = `/tmp/finalize-nachweis-${invoice.easybill_document_id}.pdf`;
await fs.writeFile(path, pdf);
console.log(`[nachweis] PDF gespeichert: ${path} (${pdf.length} bytes)`);
console.log(`✅ Erfolgreich: Doc ${invoice.easybill_document_id} trägt Rechnungsnummer ${check.number}.`);

// Aufräumen: talentone_invoices als cancelled markieren + easybill-Doc stornieren
console.log(`[nachweis] Aufräumen — Row auf cancelled, easybill-Doc stornieren…`);
await supabase.from('talentone_invoices').update({ status: 'cancelled' }).eq('id', invoice.id);
try {
  const cancelRes = await fetch(`${EASYBILL_BASE}/documents/${encodeURIComponent(invoice.easybill_document_id)}/cancel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.EASYBILL_API_KEY}`, 'Content-Type': 'application/json' },
  });
  if (!cancelRes.ok) {
    const t = await cancelRes.text();
    throw new Error(`HTTP ${cancelRes.status}: ${t.slice(0, 200)}`);
  }
  console.log(`[nachweis] easybill-Doc storniert.`);
} catch (err) {
  console.warn(`[nachweis] easybill-Storno scheiterte: ${err.message}`);
  console.warn(`[nachweis] Bitte manuell stornieren: https://app.easybill.de/documents/${invoice.easybill_document_id}`);
}
console.log(`[nachweis] Fertig.`);
