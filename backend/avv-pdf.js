// Personalisierte AVV-PDF: die Titelseite wird pro Kunde neu gerendert (Firmenname
// + Anschrift eingesetzt, KEINE Platzhalter) und mit den unveraenderten Folgeseiten
// der Master-PDF zusammengefuehrt. Der Master (mit Platzhaltern) bleibt die eine
// gepflegte Quelle — personalisiert wird immer daraus generiert.
//
// Ergebnis wird pro Kunde im Storage gecacht (dokumente/avv/kunden/<id>_v<version>.pdf)
// und bei Kundendaten- oder Versionsaenderung (Hash-Vergleich) neu erzeugt.

import crypto from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { supabase } from './supabase.js';
import { fetchAsBuffer, uploadBuffer } from './storage.js';

const A4 = [595.28, 841.89];
const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** Aktuelle AVV-Version (lokale Query, um Zirkular-Import mit avv.js zu vermeiden). */
async function aktuelleVersion(agentur) {
  const a = agentur === 'nowagwirth' ? 'nowagwirth' : 'talentone';
  const { data } = await supabase.from('talentone_avv_versionen')
    .select('id, agentur, version, pdf_url, gueltig_ab')
    .eq('agentur', a)
    .order('gueltig_ab', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1).maybeSingle();
  return data || null;
}

/** Anschriftzeile aus Straße/PLZ/Ort; null wenn nichts vorhanden. */
export function adresseLine(kunde) {
  const strasse = (kunde?.strasse || '').trim();
  const plzOrt = [(kunde?.plz || '').trim(), (kunde?.ort || '').trim()].filter(Boolean).join(' ').trim();
  const teile = [strasse, plzOrt].filter(Boolean);
  return teile.length ? teile.join(', ') : null;
}

function versionLabel(version) {
  let stand = '';
  if (version?.gueltig_ab) {
    const d = new Date(version.gueltig_ab);
    if (!Number.isNaN(d.getTime())) stand = ` — Stand: ${MONATE[d.getMonth()]} ${d.getFullYear()}`;
  }
  return `Version ${version?.version || ''}${stand}`.trim();
}

function cacheHash(kunde, version) {
  const src = [kunde.firmenname, kunde.strasse, kunde.plz, kunde.ort, version.id, version.version].map(x => x || '').join('|');
  return crypto.createHash('sha256').update(src).digest('hex').slice(0, 16);
}

/**
 * Baut die personalisierte PDF: neue Titelseite (Master-Folgeseiten 2..n bleiben).
 * @returns {Promise<Buffer>}
 */
export async function personalizeAvvBuffer({ masterBuffer, firmenname, adresse, versionLabel: verLabel }) {
  const doc = await PDFDocument.load(masterBuffer);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg = await doc.embedFont(StandardFonts.Helvetica);

  const cover = doc.insertPage(0, A4); // neue Titelseite an Index 0
  doc.removePage(1);                    // alte Master-Titelseite (Platzhalter) raus

  const W = A4[0];
  const grey = rgb(0.28, 0.28, 0.28);
  const black = rgb(0.04, 0.04, 0.04);
  const center = (text, y, size, font, color = black) => {
    const s = String(text || '');
    const w = font.widthOfTextAtSize(s, size);
    cover.drawText(s, { x: (W - w) / 2, y, size, font, color });
  };

  center('Vertrag über die Verarbeitung personenbezogener Daten', 650, 16, bold);
  center('gemäß Art. 28 DSGVO (Auftragsverarbeitungsvertrag)', 628, 13, bold);
  center('– nachfolgend „Vertrag“ genannt –', 592, 11, reg, grey);
  center('zwischen', 560, 11, reg, grey);
  center(firmenname || '', 528, 12, bold);
  let y = 528;
  if (adresse) { center(adresse, 511, 10.5, reg); y = 511; }
  center('– nachfolgend „Auftraggeber“ oder „Verantwortlicher“ –', y - 29, 11, reg, grey);
  center('und', y - 59, 11, reg, grey);
  center('Nowag & Wirth GmbH & Co. KG', y - 89, 12, bold);
  center('Bäckerstraße 2, 40213 Düsseldorf', y - 106, 11, reg);
  center('– nachfolgend „Auftragnehmer“ oder „Auftragsverarbeiter“ –', y - 135, 11, reg, grey);
  center('einzeln oder gemeinsam auch „Partei“ und/oder „Parteien“', y - 165, 11, reg, grey);
  center(verLabel || '', y - 205, 10, reg, rgb(0.4, 0.4, 0.4));

  return Buffer.from(await doc.save());
}

/**
 * Liefert die (gecachte oder frisch erzeugte) personalisierte AVV-PDF-URL fuer
 * einen Kunden. Faellt bei Fehlern auf die generische Master-URL zurueck.
 * @returns {Promise<{ url: string|null, personalized: boolean }>}
 */
export async function getPersonalizedAvvPdf(kundeId) {
  const { data: kunde } = await supabase.from('talentone_kunden')
    .select('id, agentur, firmenname, strasse, plz, ort, avv_pdf_meta')
    .eq('id', kundeId).maybeSingle();
  if (!kunde) return { url: null, personalized: false };

  const version = await aktuelleVersion(kunde.agentur);
  if (!version) return { url: null, personalized: false };

  const hash = cacheHash(kunde, version);
  const meta = kunde.avv_pdf_meta;
  if (meta && meta.hash === hash && meta.url) {
    return { url: meta.url, personalized: true };
  }

  try {
    const { buffer: masterBuffer } = await fetchAsBuffer(version.pdf_url);
    const buf = await personalizeAvvBuffer({
      masterBuffer,
      firmenname: kunde.firmenname || '',
      adresse: adresseLine(kunde),
      versionLabel: versionLabel(version),
    });
    const path = `avv/kunden/${kunde.id}_v${version.version}.pdf`;
    const publicUrl = await uploadBuffer({ bucket: 'dokumente', path, buffer: buf, contentType: 'application/pdf', upsert: true });
    // Cache-Buster, damit eine neue Fassung nicht aus dem CDN-Cache kommt.
    const url = `${publicUrl}?v=${hash}`;
    await supabase.from('talentone_kunden')
      .update({ avv_pdf_meta: { hash, url, path, version_id: version.id, generated_at: new Date().toISOString() } })
      .eq('id', kunde.id);
    return { url, personalized: true };
  } catch (e) {
    console.warn('[avv-pdf] Generierung fehlgeschlagen — Fallback Master:', e.message);
    return { url: version.pdf_url, personalized: false };
  }
}
