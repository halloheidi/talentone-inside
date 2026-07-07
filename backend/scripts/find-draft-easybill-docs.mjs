#!/usr/bin/env node
// Bestandsaufnahme: welche easybill-Dokumente aus dem Tool stehen noch im
// Entwurfsstatus?
//
// Prüft:
//   - alle talentone_invoices.easybill_document_id
//   - alle talentone_offers.easybill_order_document_id (Auftragsbestätigungen)
//
// Angebote (talentone_offers.easybill_document_id) werden bewusst NICHT
// gelistet — die dürfen Draft sein, bis sie das erste Mal versandt werden
// (dann finalisiert der Versand-Endpoint automatisch).
//
// Ausgabe: Tabelle (stdout) je Zeile: kind, tool_id, easybill_id, brand,
// customer, amount_gross, created_at, easybill_status, easybill_number.

import { supabase } from '../supabase.js';
import { getDocument } from '../easybill.js';

// Inline-Version — funktioniert auch, wenn der laufende Container-Code
// looksLikeDraft noch nicht exportiert (Bestandsaufnahme muss vor dem
// Deploy funktionieren, damit man vergleichen kann).
function looksLikeDraft(doc) {
  if (!doc) return false;
  if (doc.number == null || String(doc.number).trim() === '') return true;
  if (doc.document_type === 'DRAFT' || doc.status === 'DRAFT') return true;
  return false;
}

const EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

async function checkDoc(id) {
  try {
    const doc = await getDocument(id);
    return { ok: true, doc, isDraft: looksLikeDraft(doc) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function main() {
  const [invRes, offerRes] = await Promise.all([
    supabase.from('talentone_invoices')
      .select('id, invoice_type, source, brand, easybill_document_id, easybill_invoice_number, amount_gross, created_at, customer_id, offer_id, label, status')
      .not('easybill_document_id', 'is', null)
      .order('created_at', { ascending: false }),
    supabase.from('talentone_offers')
      .select('id, brand, easybill_order_document_id, first_month_total, customer_snapshot, created_at, accepted_at')
      .not('easybill_order_document_id', 'is', null)
      .order('created_at', { ascending: false }),
  ]);

  const draftRows = [];

  console.log('[Bestandsaufnahme] Rechnungen prüfen (talentone_invoices)…');
  for (const inv of invRes.data || []) {
    const r = await checkDoc(inv.easybill_document_id);
    if (r.ok && r.isDraft) {
      draftRows.push({
        kind:          `${inv.source === 'standalone' ? 'STANDALONE-' : ''}${inv.invoice_type}`.toUpperCase(),
        tool_id:       inv.id,
        easybill_id:   inv.easybill_document_id,
        brand:         inv.brand,
        amount:        EUR.format(Number(inv.amount_gross) || 0),
        created_at:    inv.created_at,
        row_status:    inv.status,
        number_in_db:  inv.easybill_invoice_number || '—',
        note:          inv.label || '',
      });
    } else if (!r.ok) {
      console.warn(`  [warn] Invoice ${inv.id} → easybill ${inv.easybill_document_id}: ${r.error}`);
    }
  }

  console.log('[Bestandsaufnahme] Auftragsbestätigungen prüfen (talentone_offers)…');
  for (const off of offerRes.data || []) {
    const r = await checkDoc(off.easybill_order_document_id);
    if (r.ok && r.isDraft) {
      draftRows.push({
        kind:          'CHARGE_CONFIRM',
        tool_id:       off.id,
        easybill_id:   off.easybill_order_document_id,
        brand:         off.brand,
        amount:        EUR.format(Number(off.first_month_total) || 0),
        created_at:    off.created_at,
        row_status:    'accepted',
        number_in_db:  '—',
        note:          off.customer_snapshot?.company_name || '',
      });
    } else if (!r.ok) {
      console.warn(`  [warn] Offer ${off.id} → easybill ${off.easybill_order_document_id}: ${r.error}`);
    }
  }

  if (draftRows.length === 0) {
    console.log('\n✅ Keine offenen Entwürfe gefunden — alle Bestandsdocs sind finalisiert.');
    return;
  }

  console.log(`\n⚠ ${draftRows.length} Entwurfs-Dokument(e) gefunden:\n`);
  console.table(draftRows);

  console.log(`\nHinweis: die Finalisierung dieser Bestandsfälle wird NICHT`);
  console.log(`automatisch ausgelöst — bitte einzeln entscheiden (siehe README`);
  console.log(`bzw. Rücksprache — evtl. wurde die Rechnung schon manuell in`);
  console.log(`easybill nachgezogen, dann wäre Auto-Finalisieren eine Dublette).`);
}

main().catch(err => { console.error(err); process.exit(1); });
