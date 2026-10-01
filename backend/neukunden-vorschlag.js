// Daten-Vorschlag aus einem hochgeladenen Formular (PDF/DOCX) für Neukunden-Projekte.
// Reiner Lese-/Mapping-Pfad: Text extrahieren → KI-Mapping auf neukunden_daten-Felder
// → als Vorschlag (NIE direkt in neukunden_daten). Geteilt von der Akte-Upload-Route
// (Auto-Auswertung) und dem „Auswerten"-Button am Job.

import { supabase } from './supabase.js';
import { extractFromFile } from './extractor.js';

// Nur diese Felder dürfen aus einem Formular vorgeschlagen werden (= neukunden_daten-Schema).
export const NEUKUNDEN_VORSCHLAG_FELDER = ['produkt', 'kundenprofil', 'zielgruppe', 'einzugsgebiet', 'preisrahmen', 'vorteile', 'unterschied'];

export function dateiTyp(name, fileType, contentType) {
  const n = (name || '').toLowerCase();
  const ct = (contentType || fileType || '').toLowerCase();
  if (n.endsWith('.pdf') || ct.includes('pdf')) return 'pdf';
  if (n.endsWith('.docx') || ct.includes('wordprocessingml') || fileType === 'docx') return 'docx';
  return null;
}

function pickFelder(extracted) {
  const out = {};
  for (const f of NEUKUNDEN_VORSCHLAG_FELDER) {
    const v = extracted?.[f];
    if (f === 'vorteile') {
      if (Array.isArray(v) && v.filter(Boolean).length) out[f] = v.filter(Boolean).map(x => String(x).trim());
    } else if (typeof v === 'string' && v.trim()) {
      out[f] = v.trim();
    }
  }
  return out;
}

/**
 * Erzeugt einen Vorschlag aus Datei-Bytes oder einer Datei-URL.
 * Wirft Error mit .code: 'format' | 'kein_text' | 'kein_mapping'.
 * @returns {{ dateiname, quelle_url, vorschlag, erstellt_am }}
 */
export async function erzeugeVorschlag({ base64, fileType, dateiname, datei_url }) {
  let b64 = base64, name = dateiname, ct = null;
  if (!b64 && datei_url) {
    const { fetchAsBuffer } = await import('./storage.js');
    const { buffer, contentType } = await fetchAsBuffer(datei_url);
    b64 = buffer.toString('base64'); ct = contentType;
    name = name || decodeURIComponent((datei_url.split('/').pop() || '').split('?')[0]);
  }
  if (!b64) { const e = new Error('Keine Datei übergeben.'); e.code = 'format'; throw e; }
  const typ = dateiTyp(name, fileType, ct);
  if (!typ) { const e = new Error('Nur PDF- oder DOCX-Dateien können ausgewertet werden.'); e.code = 'format'; throw e; }

  let extracted;
  try {
    extracted = await extractFromFile(b64, typ, { projekttyp: 'neukundengewinnung' });
  } catch (err) {
    // extractFromFile wirft „Konnte keinen Text aus der Datei lesen." bei Scans ohne Textebene.
    const e = new Error(err.message || 'kein Text'); e.code = 'kein_text'; throw e;
  }
  const vorschlag = pickFelder(extracted);
  if (!Object.keys(vorschlag).length) { const e = new Error('Keine Neukunden-Felder erkannt.'); e.code = 'kein_mapping'; throw e; }
  return { dateiname: name || 'Dokument', quelle_url: datei_url || null, vorschlag, erstellt_am: new Date().toISOString() };
}

export async function speichereVorschlag(jobId, payload) {
  const { error } = await supabase.from('talentone_jobs')
    .update({ neukunden_vorschlag: payload, updated_at: new Date().toISOString() }).eq('id', jobId);
  if (error) throw new Error(error.message);
}
