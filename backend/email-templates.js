// Zentraler Template-Service für Kunden-Mails.
//
//   const tpl = await renderEmail('entwurf_runde', kunde, { stelle, runde, review_link });
//   const subject = tpl?.subject ?? <Code-Default>;
//   const body    = tpl?.body    ?? <Code-Default>;
//
// - Lädt die Vorlage nach key + agentur des Kunden (Fallback: Vorlage ohne
//   passende Agentur → erste aktive für den key).
// - Wählt Du-/Sie-Fassung anhand kunde.anrede_form (Default 'du').
// - Ersetzt {{platzhalter}} (Standard: ansprechpartner, firmenname, agentur_name +
//   alle Werte aus `daten`). Unbekannte Platzhalter → leer + Warnung im Log.
// - Keine Vorlage vorhanden → null (der Aufrufer nutzt seinen Code-Default).
//   Ein fehlendes/kaputtes Template bricht den Versand NIE ab.

import { supabase } from './supabase.js';
import { getBranding } from './branding.js';
import { anredeForm } from './anrede.js';

function agenturOf(kunde) {
  return kunde?.agentur === 'nowagwirth' ? 'nowagwirth' : 'talentone';
}

function replacePlaceholders(str, ctx, key) {
  if (str == null) return str;
  return String(str).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, name) => {
    if (Object.prototype.hasOwnProperty.call(ctx, name) && ctx[name] != null) return String(ctx[name]);
    console.warn(`[email-templates] Unbekannter Platzhalter {{${name}}} in Vorlage "${key}" — leer ersetzt.`);
    return '';
  });
}

// Baut den Ersetzungs-Kontext (Standard-Variablen + daten) — auch für Vorschau.
export function buildContext(kunde, daten = {}) {
  const brand = getBranding(agenturOf(kunde));
  return {
    ansprechpartner: kunde?.ansprechpartner || '',
    firmenname: kunde?.firmenname || '',
    agentur_name: brand?.name || '',
    ...daten,
  };
}

// Ersetzt {{platzhalter}} in einem beliebigen String (für Live-Vorschau/Test-Mail
// mit noch nicht gespeicherten Editor-Inhalten).
export function renderString(str, kunde, daten = {}, key = 'preview') {
  return replacePlaceholders(str, buildContext(kunde, daten), key);
}

export async function renderEmail(key, kunde, daten = {}) {
  const agentur = agenturOf(kunde);
  let tpl = null;
  try {
    const { data } = await supabase.from('talentone_email_templates')
      .select('*').eq('key', key).eq('agentur', agentur).eq('aktiv', true).maybeSingle();
    tpl = data || null;
    if (!tpl) {
      // Fallback: irgendeine aktive Vorlage für diesen key.
      const { data: any } = await supabase.from('talentone_email_templates')
        .select('*').eq('key', key).eq('aktiv', true)
        .order('agentur', { ascending: true }).limit(1).maybeSingle();
      tpl = any || null;
    }
  } catch (err) {
    console.warn(`[email-templates] Laden "${key}" fehlgeschlagen: ${err.message} — Code-Default.`);
    return null;
  }
  if (!tpl) return null;

  const form = anredeForm(kunde) === 'sie' ? 'sie' : 'du';
  const subjectRaw = form === 'sie' ? (tpl.betreff_sie ?? tpl.betreff_du) : (tpl.betreff_du ?? tpl.betreff_sie);
  const bodyRaw    = form === 'sie' ? (tpl.body_sie ?? tpl.body_du)       : (tpl.body_du ?? tpl.body_sie);

  const brand = getBranding(agentur);
  const ctx = {
    ansprechpartner: kunde?.ansprechpartner || '',
    firmenname: kunde?.firmenname || '',
    agentur_name: brand?.name || '',
    ...daten,
  };

  return {
    subject: replacePlaceholders(subjectRaw, ctx, key),
    body: replacePlaceholders(bodyRaw, ctx, key),
    template: tpl,
  };
}
