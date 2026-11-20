// Gewerk-Erkennung für den Meta-Pixel-Vorschlag.
// Signal = Stellenbezeichnung (job.stelle) + Kundenbranche (kunde.branche).
// Reihenfolge der Liste = Priorität (erster Treffer gewinnt). Kein Treffer →
// Fallback-Pixel (talentone_pixel.fallback = true).
//
// Die gewerk-Keys entsprechen talentone_pixel.gewerk:
//   shk_kaelte, elektro, maler, bau_tiefbau, fenster_ausbau,
//   kfz, land_hof, gala, kaufmaennisch   (+ handwerk_allgemein = Fallback)

const GEWERK_WORDS = [
  ['shk_kaelte',     ['anlagenmechanik', 'kälte', 'kaelte', 'shk', 'bäder', 'baeder', 'bäderbau', 'sanitär', 'sanitaer', 'heizung', 'klima', 'kältetechnik', 'kaeltetechnik']],
  ['elektro',        ['elektroniker', 'elektriker', 'elektro', 'photovoltaik', 'photovoltaikanlage', 'pv-anlage']],
  ['maler',          ['maler', 'lackier', 'baudekorat']],
  ['bau_tiefbau',    ['pflasterer', 'pflaster', 'tiefbau', 'asphalt', 'bauhelfer', 'straßenbau', 'strassenbau', 'gerüstbau', 'geruestbau', 'hochbau', 'maurer', 'kanalbau']],
  ['fenster_ausbau', ['fenster', 'monteur', 'tischler', 'schreiner', 'innenausbau', 'trockenbau', 'ausbau']],
  ['kfz',            ['kfz', 'mechatroniker', 'kraftfahrzeug', 'werkstatt', 'automobil']],
  ['land_hof',       ['hofhelfer', 'reiterhof', 'reit', 'landwirt', 'pferd', 'stall', 'hof']],
  ['gala',           ['garten', 'landschaft', 'galabau', 'gala']],
  ['kaufmaennisch',  ['vertrieb', 'sales', 'büro', 'buero', 'dispo', 'verwaltung', 'sachbearbeit', 'kaufmänn', 'kaufmaenn', 'office', 'disponent']],
];

/** Liefert den gewerk-Key für einen Freitext oder null (kein Treffer → Fallback). */
export function gewerkFor(text) {
  const s = (text || '').toString().toLowerCase();
  if (!s.trim()) return null;
  for (const [gewerk, words] of GEWERK_WORDS) {
    if (words.some(w => s.includes(w))) return gewerk;
  }
  return null;
}

/**
 * Pixel-Vorschlag für eine Stelle.
 * Die Stellenbezeichnung ist das stärkere Signal und wird ZUERST geprüft
 * (z. B. „Area Sales Manager" bei einem Klima-Hersteller → Kaufmännisch, nicht
 * SHK). Nur wenn die Stelle kein Gewerk ergibt, entscheidet die Kundenbranche.
 * @param {{stelle?:string, branche?:string}} ctx  Stellenbezeichnung + Kundenbranche
 * @param {Array} pixelList  talentone_pixel-Zeilen (mind. aktiv/fallback/gewerk)
 * @returns {{ vorschlag:object|null, gewerk:string|null, viaFallback:boolean }}
 */
export function suggestPixel({ stelle, branche } = {}, pixelList = []) {
  const aktive = (pixelList || []).filter(p => p && p.aktiv);
  const gewerk = gewerkFor(stelle) || gewerkFor(branche);
  const treffer = gewerk ? aktive.find(p => p.gewerk === gewerk) : null;
  const fallback = aktive.find(p => p.fallback) || null;
  const vorschlag = treffer || fallback;
  return { vorschlag: vorschlag || null, gewerk: treffer ? gewerk : null, viaFallback: !treffer };
}
