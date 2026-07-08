// Einstellungen (talentone_hires) + Einstellungs-Mail (Phase 5 Nachtrag).
//
// Kernaufgaben:
//   - CRUD auf Einstellungen
//   - Auswahl des richtigen E-Mail-Body-Templates (first/progress/complete)
//   - Merge-Tag-Auflösung inkl. {{extra_stelle_preis}} aus dem Katalog
//     und {{abrechnung_hinweis}} aus billing-rules.js
//   - Versand über sendEinstellungsMail (Absender wie Angebote:
//     angebote@… mit info@nowagwirth.de als Reply-To, BCC ans Team)

import { supabase } from './supabase.js';
import { pickHireMailBodyKey, resolveAbrechnungsHinweis } from './billing-rules.js';
import { sendEinstellungsMail } from './mail.js';
import { addNote as closeAddNote } from './close.js';

const EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const EXTRA_JOB_SETUP_SKU_BY_BRAND = {
  talentone:   'TO-OPT-EXTRA-JOB-SETUP',
  nowag_wirth: 'NW-OPT-EXTRA-JOB-SETUP',
};

async function fetchOffer(offerId) {
  const { data, error } = await supabase.from('talentone_offers').select('*').eq('id', offerId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Angebot nicht gefunden.');
  return data;
}

async function fetchExtraStellenPreis(brand) {
  const sku = EXTRA_JOB_SETUP_SKU_BY_BRAND[brand];
  if (!sku) return null;
  const { data } = await supabase
    .from('talentone_offer_products')
    .select('unit_price').eq('brand', brand).eq('sku', sku).maybeSingle();
  return data?.unit_price != null ? EUR.format(Number(data.unit_price)) : null;
}

async function fetchTemplates(brand, keys) {
  const { data } = await supabase
    .from('talentone_offer_templates').select('key, text').eq('brand', brand).in('key', keys);
  return Object.fromEntries((data || []).map(t => [t.key, t.text]));
}

function fillMergeTags(text, ctx) {
  return String(text || '').replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = ctx[k];
    return v == null ? '' : String(v);
  });
}

function isoDate(d = new Date()) { return new Date(d).toISOString().slice(0, 10); }
function nextMonthDe(from = new Date()) {
  const d = new Date(from); d.setMonth(d.getMonth() + 1); d.setDate(1);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ─────────────────── CRUD ───────────────────
export async function listHires(offerId) {
  const { data, error } = await supabase.from('talentone_hires').select('*')
    .eq('offer_id', offerId).order('hired_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function createHire({ offer_id, position, hired_at, note, created_by }) {
  const { data, error } = await supabase.from('talentone_hires').insert({
    offer_id,
    position: position || null,
    hired_at: hired_at || isoDate(),
    note: note || null,
    created_by: created_by || null,
  }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateHire(id, patch) {
  const { data, error } = await supabase.from('talentone_hires').update(patch).eq('id', id).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteHire(id) {
  const { error } = await supabase.from('talentone_hires').delete().eq('id', id);
  if (error) throw new Error(error.message);
  return true;
}

// ─────────────────── Mail-Vorschau ───────────────────
/**
 * Baut den vorbelegten Betreff+Text für die Einstellungs-Mail. Alle
 * Merge-Tags aufgelöst; das UI zeigt sie im Modal, User kann editieren.
 */
export async function buildHireMailPreview({ offerId, hiredAt = null, position = null, hireIndex = null }) {
  const offer = await fetchOffer(offerId);
  const snap = offer.customer_snapshot || {};
  const hiresList = await listHires(offerId);
  const hiresBefore = Number.isFinite(hireIndex) ? hireIndex : hiresList.length;
  const bodyKey = pickHireMailBodyKey({ hiresBefore, hiresTarget: offer.hires_target });
  const tpl = await fetchTemplates(offer.brand, ['hire_email_subject', bodyKey]);

  const { count: serviceFreeMonthsUsed } = await supabase
    .from('talentone_billing_skip_log')
    .select('id', { count: 'exact', head: true })
    .eq('offer_id', offerId).eq('reason', 'guarantee_no_hire');

  const abrechnungsHinweis = resolveAbrechnungsHinweis(offer, {
    hireDate: hiredAt ? new Date(hiredAt) : new Date(),
    serviceFreeMonthsUsed: serviceFreeMonthsUsed || 0,
    naechster_monat: nextMonthDe(hiredAt ? new Date(hiredAt) : new Date()),
  });
  const extraPreis = await fetchExtraStellenPreis(offer.brand);

  const ctx = {
    ansprechpartner: [snap.first_name, snap.last_name].filter(Boolean).join(' ').trim() || 'zusammen',
    firma:           snap.company_name || '',
    position:        position || hiresList[0]?.position || 'Ihre offene Position',
    einstellungsdatum: hiredAt ? new Date(hiredAt).toLocaleDateString('de-DE') : new Date().toLocaleDateString('de-DE'),
    einstellungen_bisher: hiresBefore + 1,
    einstellungen_ziel:   Math.max(1, offer.hires_target || 1),
    abrechnung_hinweis:   abrechnungsHinweis,
    extra_stelle_preis:   extraPreis || '—',
    naechster_monat:      nextMonthDe(hiredAt ? new Date(hiredAt) : new Date()),
  };

  return {
    subject:      fillMergeTags(tpl.hire_email_subject || 'Einstellung erfasst', ctx),
    body:         fillMergeTags(tpl[bodyKey] || '', ctx),
    body_key:     bodyKey,
    default_to:   snap.email || null,
    firma:        ctx.firma,
    hires_before: hiresBefore,
    hires_target: ctx.einstellungen_ziel,
  };
}

/**
 * Erfasst eine Einstellung + versendet (optional) die Mail. Idempotenz für
 * die Mail: der Aufrufer kontrolliert es (Checkbox im UI); wir loggen
 * mail_sent_at pro Row.
 */
export async function recordHireAndMail({
  offerId, position, hired_at, note, created_by,
  send_mail = true, to = null, subject = null, body = null,
}) {
  const hire = await createHire({ offer_id: offerId, position, hired_at, note, created_by });
  const offer = await fetchOffer(offerId);

  let mailResult = null;
  if (send_mail && to && subject && body) {
    try {
      await sendEinstellungsMail({ to, offerBrand: offer.brand, subject, body });
      const nowIso = new Date().toISOString();
      await supabase.from('talentone_hires').update({
        mail_sent_at: nowIso, mail_sent_to: to,
      }).eq('id', hire.id);
      mailResult = { sent: true, to };

      // Close-Notiz (best-effort)
      if (offer.close_lead_id) {
        const idx = await currentHireCount(offerId);
        closeAddNote({
          leadId: offer.close_lead_id,
          note: `🎉 Einstellung ${idx}/${offer.hires_target || 1} erfasst: ${position || '—'} am ${hire.hired_at}`,
        }).catch(err => console.warn('[hire close-note]', err.message));
      }
    } catch (err) {
      console.error('[hire mail]', err.message);
      mailResult = { sent: false, error: err.message };
    }
  }

  // Wenn wir gerade TalentOne aus dem servicefreien Monat kommen: das Team
  // wird über den UI-Reaktivierungs-Button entscheiden. Automatik nicht.
  return { hire, mail: mailResult };
}

async function currentHireCount(offerId) {
  const { count } = await supabase.from('talentone_hires')
    .select('id', { count: 'exact', head: true }).eq('offer_id', offerId);
  return count || 0;
}
