// Projekt-Automatik: erzeugt bei accepted-Übergang eines Angebots
// automatisch eine Projekt-Card in `talentone_projekte` (falls noch keine
// mit dieser offer_id existiert). Wird sowohl vom offer-sync-Rücksync
// als auch vom Direkt-AB-Endpoint aufgerufen.

import { supabase } from './supabase.js';
import { createKundeFromSnapshot } from './offer-linking.js';
import { invalidateKanban } from './kanban-cache.js';

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
 * Best-effort-Stellenname aus dem Angebot. Die KI-Beschreibungen nennen die
 * Rolle verlässlich als „für die Stelle <Rolle>" / „für die Position <Rolle>"
 * (siehe positions_snapshot/leistungsbeschreibung). Gefunden → bereinigter Titel
 * (ohne „(m/w/d)"), sonst null → Aufrufer nutzt Platzhalter zum Umbenennen.
 *
 * @param {object} offer — talentone_offers-Row
 * @returns {string|null}
 */
export function stellennameAusAngebot(offer) {
  const texte = [];
  if (Array.isArray(offer?.positions_snapshot)) {
    for (const p of offer.positions_snapshot) if (p?.description) texte.push(String(p.description));
  }
  if (offer?.leistungsbeschreibung) texte.push(String(offer.leistungsbeschreibung));
  if (offer?.ki_kontext?.freitext) texte.push(String(offer.ki_kontext.freitext));
  const hay = texte.join('\n');
  const m = hay.match(/für die (?:Stelle|Position)\s+([^.,;:\n(]{2,60})/i);
  if (m) {
    const s = m[1].trim().replace(/\s*\((?:m\/w\/d|w\/m\/d|d\/m\/w|m\/w|w\/m)\)\s*$/i, '').trim();
    if (s) return s.slice(0, 120);
  }
  return null;
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

  // Angebot ohne Inside-Kunden (easybill-only): JETZT — bei Annahme, nicht vorher —
  // den Kunden aus easybill-Snapshot + Close anlegen (anrede_form aus dem KI-Panel,
  // close_lead_id vom Angebot). So erzeugt ein abgelehntes Angebot keinen
  // Karteileichen-Kunden.
  let customerId = offer.customer_id || null;
  if (!customerId) {
    try {
      const neu = await createKundeFromSnapshot({
        snapshot: offer.customer_snapshot, brand: offer.brand,
        anredeForm: offer.ki_kontext?.anrede_form,
        closeLeadId: offer.close_lead_id,
      });
      customerId = neu.id;
      await supabase.from('talentone_offers').update({ customer_id: customerId }).eq('id', offer.id);
    } catch (e) {
      console.warn('[ensureProjektForOffer] Inside-Kunde-Anlage fehlgeschlagen:', e.message);
    }
  }

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
  const agentur = offer.brand === 'nowag_wirth' ? 'nowagwirth' : 'talentone';
  const firma = offer.customer_snapshot?.company_name || 'Kunde';
  const projektname = `${firma} — ${brandLabel}`.slice(0, 200);
  const stellenTitel = stellennameAusAngebot(offer);

  // Garantie 1:1 aus dem Angebot übernehmen — Zeitraum UND Beschreibungstext,
  // nicht nur das Flag. Ist im Angebot ein Freitext (guarantee_note) gepflegt,
  // wird dieser komplett übernommen; erwähnt er die Frist nicht, hängen wir sie
  // an, damit im Projekt immer Frist + Text stehen. Ohne Freitext bauen wir den
  // Standard-Erfolgsgarantie-Satz mit der Frist.
  const guaranteeDays = Number(offer.guarantee_period_days) || 0;
  const guaranteeActive = guaranteeDays > 0;
  let guaranteeText = null;
  if (guaranteeActive) {
    const note = typeof offer.guarantee_note === 'string' ? offer.guarantee_note.trim() : '';
    if (note) {
      const nenntFrist = new RegExp(`\\b${guaranteeDays}\\s*Tag`, 'i').test(note);
      guaranteeText = nenntFrist ? note : `${note} (Erfolgsgarantie-Frist: ${guaranteeDays} Tage)`;
    } else {
      guaranteeText = `Erfolgsgarantie ${guaranteeDays} Tage — kostenlose Weiterarbeit bis zur ersten Einstellung.`;
    }
  }

  const { data: created, error } = await supabase
    .from('talentone_projekte')
    .insert({
      projekt:            projektname,
      kunde:              firma,
      kunde_id:           customerId,
      agentur,
      gesuchte_positionen: stellenTitel || null,
      close_lead_id:      offer.close_lead_id || null,
      offer_id:           offer.id,
      projektart:         brandLabel,
      status:             'vorbereitung',
      auftrag_checkliste: items,
      garantie:           guaranteeActive,
      garantie_details:   guaranteeText,
      // Vertragsmodell/Laufzeit aus dem Angebot vorbelegen (nur wenn gepflegt —
      // Baukasten-Angebote haben das nicht und lassen die Felder null). Start-Datum
      // bleibt bewusst leer: es wird bei Go-Live gesetzt.
      ...(offer.vertragsmodell ? { vertragsmodell: offer.vertragsmodell } : {}),
      ...(offer.laufzeit_wert != null ? { laufzeit_wert: offer.laufzeit_wert } : {}),
      ...(offer.laufzeit_einheit ? { laufzeit_einheit: offer.laufzeit_einheit } : {}),
      // Werbebudget-Modus aus dem Angebot: bei 'empfehlung' hinterlegt das Team
      // das Kunden-Zahlungsmittel im Werbekonto (kein Zahlungslink-Flow).
      werbebudget_modus:      offer.werbebudget_modus || 'position',
      tagesbudget_empfehlung: offer.tagesbudget_empfehlung ?? null,
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

  // Stelle(n) am Projekt anlegen (nur wenn ein Inside-Kunde vorhanden/angelegt ist —
  // talentone_jobs.kunde_id ist NOT NULL). Jede Stelle im Angebot = ein Job am selben
  // Projekt (Vertrag/Garantie liegen am Projekt und gelten damit für alle Stellen).
  // Erst dadurch erscheint der Kunde im Stellen-Kanban mit Chip „Vorbereitung" und
  // NICHT in den Altprojekten (= Projekte ohne verknüpfte Stelle).
  if (customerId) {
    try {
      const anzahlStellen = Math.max(1, 1 + (Number(offer.additional_positions_count) || 0));
      const kurz = offer.easybill_document_id || String(offer.id).slice(0, 8);
      const jobRows = [];
      for (let i = 0; i < anzahlStellen; i++) {
        // Titel nur für die erste Stelle aus dem Angebot ableitbar (es gibt keine
        // getrennten Titel je Stelle); weitere bekommen einen Platzhalter zum Umbenennen.
        const stelle = (i === 0 && stellenTitel)
          ? stellenTitel
          : `Stelle aus Angebot ${kurz}${anzahlStellen > 1 ? ` (${i + 1})` : ''}`;
        jobRows.push({
          kunde_id:    customerId,
          projekt_id:  created.id,
          stelle,
          projekttyp:  'mitarbeitergewinnung',
        });
      }
      const { error: jobErr } = await supabase.from('talentone_jobs').insert(jobRows);
      if (jobErr) console.warn('[ensureProjektForOffer] Stellen-Anlage fehlgeschlagen:', jobErr.message);
    } catch (e) {
      console.warn('[ensureProjektForOffer] Stellen-Anlage fehlgeschlagen:', e.message);
    }
  }

  invalidateKanban();
  return { projekt: created, created: true };
}
