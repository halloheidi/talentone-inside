// Bestandskunden-Sync: nächtlicher easybill-Abgleich (Kunden + Rechnungen) +
// Rückrichtung des Close-Task-Status. Eigenständig, kein Bezug zu talentone_kunden.
//
// easybill liefert Beträge als GANZZAHL-CENTS (wie invoice-sync.js) → /100.
// Entwürfe (is_draft) werden ausgelassen. Voll-Scan der Typen INVOICE/CREDIT/STORNO
// je Lauf (überschaubare Menge), idempotent per easybill_document_id.

import { supabase } from './supabase.js';
import { listCustomers, listDocuments } from './easybill.js';
import { getTask } from './close.js';

const DOC_TYPES = ['INVOICE', 'CREDIT', 'STORNO'];
const PAGE_SIZE = 100;

let running = false;
let lastRunAt = null;
let lastResult = null;

export function getBestandskundenSyncStatus() {
  return { running, last_run_at: lastRunAt, last_result: lastResult };
}

const centsToEuro = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n) / 100;
};

// Firmenname-Normalisierung fürs Matching (Rechtsformen weg, Umlaute gefaltet).
export function normFirma(s) {
  return String(s ?? '').toLowerCase()
    .replace(/[äöü]/g, m => ({ ä: 'ae', ö: 'oe', ü: 'ue' }[m])).replace(/ß/g, 'ss')
    .replace(/\b(gmbh|mbh|co\.?\s?kg|kg|ug|ag|e\.?\s?k\.?|haftungsbeschraenkt|gbr|ohg|e\.?\s?v\.?|ltd|inh\.?)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function firmaAusCustomer(c) {
  const company = String(c?.company_name || '').trim();
  if (company) return company;
  const person = `${c?.first_name || ''} ${c?.last_name || ''}`.trim();
  return person || `Kunde ${c?.number || c?.id || ''}`.trim();
}

/**
 * Findet den Bestandskunden zu einer easybill-Kundennummer (primär) und legt ihn
 * bei Bedarf an. Bei Umbenennungen (gleiche Nummer, neuer Name) wird NICHT dupliziert:
 * eindeutige Nummer → bestehender Kunde; mehrere → nach firma disambiguiert.
 * Erweitert `quelle` auf 'lexoffice_alt + easybill', wenn Alt-Bestand vorhanden.
 * @param {Map} byNr  kundennummer → [{id, firma, quelle}]
 * @returns {Promise<{kunde:object, neu:boolean}>}
 */
async function findOrCreateBkKunde(byNr, kundennummer, firma, adresse = {}) {
  const cands = byNr.get(kundennummer) || [];
  let kunde = null;
  if (cands.length === 1) kunde = cands[0];
  else if (cands.length > 1) {
    kunde = cands.find(c => c.firma === firma)
      || cands.find(c => normFirma(c.firma) === normFirma(firma))
      || cands[0];
  }

  if (kunde) {
    // quelle ggf. auf kombiniert erweitern (Alt-Bestand + jetzt easybill).
    if (kunde.quelle && kunde.quelle.includes('lexoffice_alt') && !kunde.quelle.includes('easybill')) {
      await supabase.from('talentone_bk_kunden')
        .update({ quelle: 'lexoffice_alt + easybill', updated_at: new Date().toISOString() })
        .eq('id', kunde.id);
      kunde.quelle = 'lexoffice_alt + easybill';
    }
    return { kunde, neu: false };
  }

  // Neu: reiner easybill-Kunde.
  const { data: neu, error } = await supabase.from('talentone_bk_kunden')
    .upsert({
      kundennummer, firma,
      plz: adresse.zip_code || null,
      ort: adresse.city || null,
      quelle: 'easybill',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'kundennummer,firma' })
    .select('id, kundennummer, firma, quelle').single();
  if (error) throw new Error(`bk_kunde anlegen (${kundennummer}): ${error.message}`);
  byNr.set(kundennummer, [...(byNr.get(kundennummer) || []), neu]);
  return { kunde: neu, neu: true };
}

/** easybill → Bestandskunden (Kunden + Rechnungen). */
async function runEasybillSync() {
  // 1) Kunden-Cache: easybill-id → customer
  const custById = new Map();
  let page = 1, pages = 1;
  while (page <= pages) {
    const res = await listCustomers({ page, limit: 1000 });
    pages = Math.max(res.pages || 1, 1);
    for (const c of res.items) custById.set(String(c.id), c);
    page++;
  }

  // 2) Lokaler Kunden-Index: kundennummer → [{id, firma, quelle}]
  const { data: bkKunden, error: kErr } = await supabase.from('talentone_bk_kunden')
    .select('id, kundennummer, firma, quelle');
  if (kErr) throw new Error(`bk_kunden laden: ${kErr.message}`);
  const byNr = new Map();
  for (const k of bkKunden || []) {
    if (!byNr.has(k.kundennummer)) byNr.set(k.kundennummer, []);
    byNr.get(k.kundennummer).push(k);
  }

  // 3) Dokumente je Typ paginiert ziehen (Entwürfe raus).
  let neu = 0, aktualisiert = 0, fehler = 0, gesehen = 0;
  const rechnungenUpsert = [];
  for (const typ of DOC_TYPES) {
    let p = 1, pgs = 1;
    while (p <= pgs) {
      let res;
      try { res = await listDocuments({ page: p, limit: PAGE_SIZE, types: [typ] }); }
      catch (err) { console.warn(`[bk-sync] listDocuments ${typ} p${p}: ${err.message}`); fehler++; break; }
      pgs = Math.max(res.pages || 1, 1);
      for (const doc of res.items) {
        if (doc.is_draft) continue;
        gesehen++;
        const cust = custById.get(String(doc.customer_id));
        const kundennummer = String(cust?.number || doc.customer_id || '').trim();
        if (!kundennummer) { fehler++; continue; }
        const firma = firmaAusCustomer(cust || { number: kundennummer });
        try {
          const { kunde } = await findOrCreateBkKunde(byNr, kundennummer, firma, cust || {});
          rechnungenUpsert.push({
            bk_kunde_id: kunde.id,
            dokument_nr: doc.number ? String(doc.number) : null,
            easybill_document_id: String(doc.id),
            datum: (doc.document_date || doc.date || '').slice(0, 10) || null,
            art: DOC_TYPES.includes(doc.type) ? doc.type : 'INVOICE',
            netto: centsToEuro(doc.amount_net),
            brutto: centsToEuro(doc.amount),
            quelle: 'easybill',
          });
        } catch (err) { console.warn('[bk-sync]', err.message); fehler++; }
      }
      // Kleine Pause gegen Rate-Limits.
      await new Promise(r => setTimeout(r, 150));
      p++;
    }
  }

  // 4) Rechnungen idempotent upserten (per easybill_document_id).
  for (let i = 0; i < rechnungenUpsert.length; i += 300) {
    const chunk = rechnungenUpsert.slice(i, i + 300).filter(r => r.datum);
    if (!chunk.length) continue;
    const { error } = await supabase.from('talentone_bk_rechnungen')
      .upsert(chunk, { onConflict: 'easybill_document_id' });
    if (error) { console.warn('[bk-sync] rechnungen-upsert:', error.message); fehler++; }
    else aktualisiert += chunk.length;
  }

  return { gesehen, verarbeitet: rechnungenUpsert.length, upsertet: aktualisiert, neue_kunden: neu, fehler };
}

/** Rückrichtung: Close-Task-Status für alle Kunden mit close_task_id abgleichen. */
export async function runCloseTaskStatusSync() {
  if (!process.env.CLOSE_API_KEY) return { skipped: 'no_close_key' };
  const { data: kunden } = await supabase.from('talentone_bk_kunden')
    .select('id, close_task_id, close_task_status').not('close_task_id', 'is', null);
  let erledigt = 0, geloescht = 0, geprueft = 0;
  for (const k of kunden || []) {
    geprueft++;
    try {
      const task = await getTask(k.close_task_id);
      if (task?.is_complete && k.close_task_status !== 'erledigt') {
        await supabase.from('talentone_bk_kunden')
          .update({ close_task_status: 'erledigt', updated_at: new Date().toISOString() }).eq('id', k.id);
        erledigt++;
      }
    } catch (err) {
      // 404 → Task in Close gelöscht → zurücksetzen.
      if (/404/.test(err.message)) {
        await supabase.from('talentone_bk_kunden')
          .update({ close_task_id: null, close_task_status: 'kein_task', updated_at: new Date().toISOString() }).eq('id', k.id);
        geloescht++;
      } else {
        console.warn('[bk-close-status]', err.message);
      }
    }
  }
  return { geprueft, erledigt, geloescht };
}

export async function runBestandskundenSync() {
  if (running) return lastResult;
  running = true;
  const start = new Date();
  let result = {};
  try {
    const eb = process.env.EASYBILL_API_KEY ? await runEasybillSync() : { skipped: 'no_easybill_key' };
    const close = await runCloseTaskStatusSync();
    result = { easybill: eb, close, duration_ms: Date.now() - start.getTime() };
    lastResult = result;
    lastRunAt = new Date().toISOString();
    await supabase.from('talentone_bk_sync_log').insert({
      quelle: 'easybill+close',
      gestartet_at: start.toISOString(),
      beendet_at: new Date().toISOString(),
      neu: eb.neue_kunden || 0,
      aktualisiert: eb.upsertet || 0,
      fehler: eb.fehler || 0,
      meldung: JSON.stringify(result).slice(0, 900),
    });
    console.log('[bk-sync] fertig:', JSON.stringify(result));
    return result;
  } catch (err) {
    console.error('[bk-sync] Fehler:', err.message);
    lastResult = { error: err.message };
    await supabase.from('talentone_bk_sync_log').insert({
      quelle: 'easybill+close', gestartet_at: start.toISOString(), beendet_at: new Date().toISOString(),
      fehler: 1, meldung: err.message.slice(0, 900),
    }).catch(() => {});
    throw err;
  } finally {
    running = false;
  }
}

// Täglich 03:00 Berlin.
export function startBestandskundenScheduler() {
  if (!process.env.EASYBILL_API_KEY) {
    console.warn('[bk-sync] EASYBILL_API_KEY fehlt — Scheduler inaktiv.');
    return;
  }
  const CHECK_MS = 60 * 60 * 1000;
  const INIT_MS = 300 * 1000;
  const check = () => {
    const now = new Date();
    const berlinHour = Number(now.toLocaleString('de-DE', { hour: '2-digit', hour12: false, timeZone: 'Europe/Berlin' }));
    if (berlinHour !== 3) return;
    runBestandskundenSync().catch(err => console.error('[bk-sync]', err.message));
  };
  setTimeout(() => { check(); setInterval(check, CHECK_MS); }, INIT_MS);
  console.log('[bk-sync] Scheduler aktiv (täglich 03:00 Berlin).');
}
