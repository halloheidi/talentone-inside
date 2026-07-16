// Verknüpfung Angebote ↔ interne Kunden (talentone_kunden).
// Härtet die Auto-Zuordnung (Angebot kann VOR dem Kunden angelegt worden sein,
// oder ohne customer_id-Kontext aus dem globalen Wizard) und ermöglicht
// Nachzuordnung (verwaiste Angebote finden + verknüpfen).

import { supabase } from './supabase.js';

/**
 * Ermittelt die interne talentone_kunden.id für ein Angebot.
 * Reihenfolge: expliziter customer_id → easybill-Cache-Email → Snapshot-Email
 * → Snapshot-Firmenname. E-Mail-Vergleich case-insensitiv (ilike).
 * @returns {Promise<string|null>}
 */
export async function resolveKundeIdForOffer({ customer_id, easybill_customer_id, customer_snapshot }) {
  if (customer_id) return customer_id;
  const snap = customer_snapshot || {};

  const emails = [];
  if (easybill_customer_id) {
    const { data: ebc } = await supabase.from('talentone_easybill_customers')
      .select('email').eq('easybill_id', String(easybill_customer_id)).maybeSingle();
    if (ebc?.email) emails.push(ebc.email);
  }
  if (snap.email) emails.push(snap.email);

  for (const email of emails) {
    const { data: k } = await supabase.from('talentone_kunden')
      .select('id').ilike('email', String(email).trim()).limit(1).maybeSingle();
    if (k?.id) return k.id;
  }

  const firma = snap.company_name || snap.firmenname;
  if (firma) {
    const { data: k } = await supabase.from('talentone_kunden')
      .select('id').ilike('firmenname', String(firma).trim()).limit(1).maybeSingle();
    if (k?.id) return k.id;
  }
  return null;
}

/**
 * Verwaiste Angebote (customer_id IS NULL), die zu einem Kunden passen
 * (per E-Mail — Snapshot oder easybill-Cache — oder exaktem Firmennamen).
 * @returns {Promise<Array>}
 */
export async function findVerwaisteAngeboteForKunde(kunde) {
  if (!kunde) return [];
  const { data: offers } = await supabase.from('talentone_offers')
    .select('id, brand, status, easybill_customer_id, customer_snapshot, setup_total, monthly_total, first_month_total, created_at')
    .is('customer_id', null);
  if (!offers?.length) return [];

  const email = (kunde.email || '').toLowerCase().trim();
  const firma = (kunde.firmenname || '').toLowerCase().trim();

  const ebIds = [...new Set(offers.map(o => o.easybill_customer_id).filter(Boolean).map(String))];
  const ebEmailById = {};
  if (ebIds.length) {
    const { data: ebs } = await supabase.from('talentone_easybill_customers')
      .select('easybill_id, email').in('easybill_id', ebIds);
    for (const e of ebs || []) ebEmailById[String(e.easybill_id)] = (e.email || '').toLowerCase();
  }

  return offers.filter(o => {
    const snap = o.customer_snapshot || {};
    const snapEmail = (snap.email || '').toLowerCase();
    const snapFirma = (snap.company_name || snap.firmenname || '').toLowerCase();
    const ebEmail = ebEmailById[String(o.easybill_customer_id)] || '';
    if (email && (snapEmail === email || ebEmail === email)) return true;
    if (firma && snapFirma && snapFirma === firma) return true;
    return false;
  });
}

/**
 * Ordnet ein Angebot einem Kunden zu und zieht verwaiste Rechnungen des
 * Angebots mit nach (customer_id).
 * @returns {Promise<object>} das aktualisierte Angebot
 */
export async function linkOfferToKunde(offerId, kundeId) {
  const { data: offer, error } = await supabase.from('talentone_offers')
    .update({ customer_id: kundeId }).eq('id', offerId).select().single();
  if (error) throw new Error(error.message);
  await supabase.from('talentone_invoices')
    .update({ customer_id: kundeId }).eq('offer_id', offerId).is('customer_id', null);
  return offer;
}
