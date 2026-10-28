// Etappe 3: Gesellenwerk-Vormerkung (intern) — geteilte Logik.
// Vormerkung hängt an der PERSON (dubletten.js), nicht am einzelnen Eingang:
// bei N× Eingängen gilt eine vorhandene Vormerkung für alle. Gewerk/Wohnort werden
// beim Lesen aus Stelle/Funnel-Antworten abgeleitet, nie kopiert.
// Rein additiv — niemals über Portal/Token-Zugänge erreichbar.

import { supabase } from './supabase.js';
import { personenGruppen } from './dubletten.js';
import { normalizeKriterienStruktur } from './kriterien.js';

export const GW_STATI = ['vorgeschlagen', 'vorgemerkt', 'uebertragen', 'zurueckgezogen'];
export const GW_QUELLEN = ['manuell', 'kundenabsage'];
export const GW_EINWILLIGUNG_ART = ['telefon', 'optin_mail'];

// Kundenfeedback-Status, die eine Absage/Nichteignung bedeuten → Automatik-Auslöser.
const ABSAGE_STATI = new Set(['absage', 'ungeeignet', 'abgesagt']);

// Gewerk = Bezeichnung der Stelle (keine eigene Taxonomie).
export function gewerkAusStelle(stelle) {
  const s = (stelle || '').toString().trim();
  return s || '–';
}

// Wohnort aus Funnel-Antworten ableiten (frage_text nach Standort/Wohnort/PLZ absuchen).
// antworten = [{ frage_text, antwort }]; Rückgabe '–', wenn nichts Passendes vorliegt.
const WOHNORT_RE = /(standort|wohnort|wohnhaft|^ort$|^stadt$|plz|postleitzahl|umkreis|region|wo\s+wohnst|wo\s+lebst|einsatzort)/i;
export function wohnortAusAntworten(antworten) {
  if (!Array.isArray(antworten)) return '–';
  for (const a of antworten) {
    const frage = (a?.frage_text || '').toString().trim();
    const wert = (a?.antwort ?? '').toString().trim();
    if (frage && wert && WOHNORT_RE.test(frage)) return wert;
  }
  return '–';
}

// Spiegelt eine (je Person einmalige) Vormerkung auf ALLE Eingänge der Person.
// rows: Bewerbungs-Zeilen EINER Stelle ({id, job_id, email, telefon}); gwByBew: bewerbung_id → Vormerkung.
// Rückgabe: bewerbung_id → Vormerkung (für jeden Eingang der Person, der eine Vormerkung hat).
export function spiegelVormerkungAufPersonen(rows, gwByBew) {
  const out = {};
  if (!gwByBew || !Object.keys(gwByBew).length) return out;
  for (const gruppe of personenGruppen(rows)) {
    const treffer = gruppe.map(r => gwByBew[r.id]).find(Boolean);
    if (treffer) for (const r of gruppe) out[r.id] = treffer;
  }
  return out;
}

// Alle Eingangs-IDs der Person (an derselben Stelle) zu einer gegebenen bewerbung_id.
async function personenEingaenge(bewerbungId, jobId) {
  const { data: alle = [] } = await supabase.from('talentone_bewerbungen')
    .select('id, job_id, email, telefon').eq('job_id', jobId);
  const gruppe = personenGruppen(alle || []).find(g => g.some(r => r.id === bewerbungId));
  return gruppe ? gruppe.map(r => r.id) : [bewerbungId];
}
export { personenEingaenge };

// Existiert für die Person (irgendein Eingang) bereits eine Vormerkung? → Zeile oder null.
export async function vormerkungDerPerson(bewerbungId, jobId) {
  const ids = await personenEingaenge(bewerbungId, jobId);
  const { data: vorhanden = [] } = await supabase.from('talentone_gesellenwerk_vormerkungen')
    .select('*').in('bewerbung_id', ids);
  return (vorhanden && vorhanden[0]) || null;
}

/**
 * Automatik bei Kundenabsage. Best-effort (wirft nie in den Aufrufer).
 * - Nur bei Status absage/ungeeignet(/abgesagt).
 * - KEIN Eintrag, wenn fachlich ungeeignet: Ampel rot UND ein KO-Kriterium auf ✗.
 * - KEIN Eintrag, wenn für die Person schon eine Vormerkung existiert.
 * - Sonst: status 'vorgeschlagen', quelle 'kundenabsage', notiz = Kundenkommentar (falls vorhanden).
 */
export async function vormerkenAusAbsage(bewerbungId, { status, kommentar } = {}) {
  try {
    if (!bewerbungId || !ABSAGE_STATI.has(status)) return;
    const { data: bew } = await supabase.from('talentone_bewerbungen')
      .select('id, job_id').eq('id', bewerbungId).maybeSingle();
    if (!bew?.job_id) return;

    // Fachlich ungeeignet? (Ampel rot UND KO-Kriterium auf ✗) → nicht vormerken.
    const [{ data: job }, { data: notiz }] = await Promise.all([
      supabase.from('talentone_jobs').select('wichtige_kriterien_struktur, wichtige_kriterien').eq('id', bew.job_id).maybeSingle(),
      supabase.from('talentone_bewerber_notizen').select('ampel, kriterien_check').eq('bewerbung_id', bewerbungId).maybeSingle(),
    ]);
    const struktur = normalizeKriterienStruktur(job?.wichtige_kriterien_struktur ?? job?.wichtige_kriterien);
    const koIds = (struktur.ko || []).map(k => k.id);
    const check = notiz?.kriterien_check || {};
    const koVerfehlt = koIds.some(id => check[id] === false);
    if (notiz?.ampel === 'rot' && koVerfehlt) return;

    // Schon eine Vormerkung für die Person? → nichts tun.
    if (await vormerkungDerPerson(bewerbungId, bew.job_id)) return;

    await supabase.from('talentone_gesellenwerk_vormerkungen').insert({
      bewerbung_id: bewerbungId,
      status: 'vorgeschlagen',
      quelle: 'kundenabsage',
      notiz: (kommentar || '').toString().trim() || null,
    });
  } catch (e) {
    console.warn('[gesellenwerk/auto]', e.message);
  }
}
