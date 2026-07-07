// Projekt-Automatik: erzeugt bei accepted-Übergang eines Angebots
// automatisch eine Projekt-Card in `talentone_projekte` (falls noch keine
// mit dieser offer_id existiert). Wird sowohl vom offer-sync-Rücksync
// als auch vom Direkt-AB-Endpoint aufgerufen.

import { supabase } from './supabase.js';

// SKUs, die eigene Checklisten-Items auslösen (an beiden Marken angeglichen).
const PHOTO_SKUS         = new Set(['NW-OPT-PHOTO']);
const PREQUALIFY_SKUS    = new Set(['TO-OPT-PREQUALIFY', 'NW-OPT-PREQUALIFY']);
const EXTRA_JOB_MONTHLY  = new Set(['TO-OPT-EXTRA-JOB', 'NW-OPT-EXTRA-JOB']);

/**
 * Rein-funktional: baut die Auftrags-Checkliste aus den Auswahl-Daten des
 * Angebots. Reihenfolge und Anzahl der Zeilen ergeben sich deterministisch
 * aus (a) Standard-Items (beide Marken), (b) optionalen Add-ons.
 *
 * @param {object} input
 * @param {Array<{sku:string,quantity?:number}>} input.selectedProducts
 *   Wie aus `talentone_offers.selected_product_ids` (Produkt-IDs bereits durch
 *   SKUs ersetzt).
 * @param {number} input.additionalPositionsCount  Extra-Stellen (0..n).
 * @returns {Array<{key:string,label:string,done:boolean}>}
 */
export function buildAuftragChecklist({
  selectedSkus = [],
  additionalPositionsCount = 0,
} = {}) {
  const skus = new Set((selectedSkus || []).filter(Boolean));
  const items = [
    { key: 'onboarding_call',      label: 'Onboarding-Call',                 done: false },
    { key: 'handyfotos_anfordern', label: 'Handyfotos beim Kunden anfordern', done: false },
    { key: 'ki_creatives',         label: 'KI-Creatives erstellen',           done: false },
    { key: 'qualifikationsseite',  label: 'Qualifikationsseite erstellen',    done: false },
    { key: 'kampagnen_setup',      label: 'Kampagnen-Setup',                  done: false },
  ];

  if ([...skus].some(sku => PHOTO_SKUS.has(sku))) {
    items.push({ key: 'fototag_terminieren', label: 'Fototag terminieren', done: false });
  }
  if ([...skus].some(sku => PREQUALIFY_SKUS.has(sku))) {
    items.push({ key: 'vorqual_briefen', label: 'Vorqualifizierung briefen (Jessica)', done: false });
  }

  const extras = Number(additionalPositionsCount) || 0;
  if (extras > 0 && [...skus].some(sku => EXTRA_JOB_MONTHLY.has(sku))) {
    for (let i = 1; i <= extras; i++) {
      items.push({
        key: `stellenprofil_${i}`,
        label: `Stellenprofil ${i} einrichten`,
        done: false,
      });
    }
  }
  return items;
}

/**
 * Idempotent: legt eine Projekt-Card für dieses Angebot an (falls noch keine
 * mit dieser offer_id existiert). Rückgabe: das (neue oder bestehende) Projekt.
 *
 * Non-blocking-Design: Aufrufer sollten Exceptions nur loggen, nicht den
 * accepted-Übergang scheitern lassen.
 *
 * @param {object} offer — talentone_offers-Row
 * @returns {Promise<{projekt:object, created:boolean}>}
 */
export async function ensureProjektForOffer(offer) {
  if (!offer?.id) throw new Error('offer.id fehlt.');

  // Duplikats-Guard: bereits Card für diese offer_id?
  const { data: existing } = await supabase
    .from('talentone_projekte')
    .select('*')
    .eq('offer_id', offer.id)
    .maybeSingle();
  if (existing) return { projekt: existing, created: false };

  // Katalog laden, SKUs für die gewählten Produkte auflösen
  const { data: products } = await supabase
    .from('talentone_offer_products')
    .select('id, sku')
    .eq('brand', offer.brand);
  const skuById = new Map((products || []).map(p => [p.id, p.sku]));

  const selected = Array.isArray(offer.selected_product_ids) ? offer.selected_product_ids : [];
  const selectedSkus = selected.map(s => skuById.get(s?.product_id)).filter(Boolean);

  const items = buildAuftragChecklist({
    selectedSkus,
    additionalPositionsCount: Number(offer.additional_positions_count) || 0,
  });

  const brandLabel = offer.brand === 'nowag_wirth' ? 'Nowag & Wirth' : 'TalentOne';
  const firma = offer.customer_snapshot?.company_name || 'Kunde';
  const projektname = `${firma} — ${brandLabel}`.slice(0, 200);

  const { data: created, error } = await supabase
    .from('talentone_projekte')
    .insert({
      projekt:            projektname,
      kunde:              firma,
      kunde_id:           offer.customer_id || null,
      close_lead_id:      offer.close_lead_id || null,
      offer_id:           offer.id,
      projektart:         brandLabel,
      status:             'vorbereitung',
      auftrag_checkliste: items,
      updated_at:         new Date().toISOString(),
    })
    .select().single();

  if (error) {
    // Rennt uns ein paralleler Sync über den UNIQUE-Index rein, greifen wir
    // das ab und liefern das bestehende Projekt zurück — Idempotenz gewahrt.
    if (String(error.message || '').toLowerCase().includes('duplicate key')) {
      const { data: raced } = await supabase
        .from('talentone_projekte').select('*').eq('offer_id', offer.id).maybeSingle();
      if (raced) return { projekt: raced, created: false };
    }
    throw new Error(`talentone_projekte insert: ${error.message}`);
  }
  return { projekt: created, created: true };
}
