// Ein Bewertungssystem für das ganze Controlling-Cockpit: Regelwerk → Ampel + benannte
// Gründe (nie nur Farbe ohne Warum). Ersetzt die alte Kritisch/Achtung-Heuristik.

/* Gewerk-Ableitung aus der Stellenbezeichnung (einfache Keyword-Zuordnung). Reihenfolge =
   Priorität: spezifischere Gewerke zuerst. Für den Gewerk-CPL-Benchmark. */
const GEWERK_REGELN = [
  ['Kfz',     /\bkfz\b|automobil|fahrzeugtechnik|nutzfahrzeug/i],
  ['Elektro', /elektr|mechatronik|photovoltaik|\bpv\b|solar|automatisierung/i],
  ['SHK',     /\bshk\b|sanitär|sanitaer|heizung|klima|kälte|kaelte|anlagenmechanik|installateur|badsanierung|kundendienst|servicetechnik/i],
  ['Bau',     /\bbau\b|maurer|tischler|schreiner|dachdecker|\bmaler\b|lackier|fenster|zimmer|pflaster|tief-|straßenbau|strassenbau|gerüst|beton|estrich|trockenbau|monteur/i],
  ['Büro',    /büro|buero|kaufmann|kauffrau|kaufm|verwaltung|sachbearbeit|assisten|vertrieb|\bsales\b|kalkulator|disponent|buchhalt/i],
];
export function gewerkVonStelle(stelle) {
  const s = String(stelle || '');
  for (const [name, re] of GEWERK_REGELN) if (re.test(s)) return name;
  return 'Sonstige';
}

/* Ø-CPL je Gewerk aus den eigenen Zeilen (nur Zeilen mit echtem CPL). Zusätzlich global. */
export function berechneBenchmark(rows) {
  const perGewerk = {}; const alle = [];
  for (const r of rows) {
    const cpl = r.meta?.cpl;
    if (cpl == null) continue;
    const g = r.gewerk || 'Sonstige';
    (perGewerk[g] ||= []).push(cpl);
    alle.push(cpl);
  }
  const schnitt = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
  const gewerk = {};
  for (const [g, arr] of Object.entries(perGewerk)) gewerk[g] = { cpl: schnitt(arr), n: arr.length };
  return { gewerk, global: schnitt(alle), global_n: alle.length };
}

/* Bewertung einer Cockpit-Zeile. Jede Regel erzeugt einen benannten Grund-Chip.
   rot gewinnt über gelb gewinnt über grün; ohne Meta/Aktivität → grau. */
export function bewerteZeile(row, benchmark) {
  const m = row.meta || null;
  const c = row.cockpit || {};
  const gruende = [];
  const rot = [], gelb = [];
  const push = (arr, code, label) => { const g = { code, label }; arr.push(g); gruende.push({ ...g, stufe: arr === rot ? 'rot' : 'gelb' }); };

  const gewerkBench = benchmark?.gewerk?.[row.gewerk]?.cpl ?? null;
  const cpl = m?.cpl ?? null;
  const lauftage = m?.aktive_lauftage ?? 0;
  const bew = m?.bewerbungen ?? null;
  const garRest = c.garantie_rest;

  // ── ROT ──
  if (lauftage >= 7 && bew === 0) push(rot, 'keine_bewerbungen', `0 Bew. seit ${lauftage} aktiven T`);
  if (garRest != null && garRest <= 0) push(rot, 'garantie_ueberzogen', `Garantie ${garRest} T (überzogen)`);
  if (m?.zahlungsproblem) push(rot, 'zahlungsproblem', 'Zahlungsproblem');
  if (c.ueberfaellig) push(rot, 'ueberfaellig', `Überfällig seit ${c.ueberfaellig_tage ?? '?'} T`);
  if (cpl != null && gewerkBench != null && cpl > 2 * gewerkBench) push(rot, 'cpl_hoch', `CPL ${cpl.toFixed(0)} € > 2× Gewerk-Ø`);

  // ── GELB ──
  if (cpl != null && gewerkBench != null && cpl > 1.3 * gewerkBench && cpl <= 2 * gewerkBench) push(gelb, 'cpl_erhoeht', `CPL ${cpl.toFixed(0)} € > 1,3× Gewerk-Ø`);
  if (garRest != null && garRest > 0 && garRest <= 14) push(gelb, 'garantie_knapp', `Garantie-Rest ${garRest} T`);
  // Bewerbungs-Einbruch: 7-Tage-Rate < 50 % der 28-Tage-Rate (nur wenn 28T genug Signal hat)
  const rate28 = m?.bewerbungen_28t != null ? m.bewerbungen_28t / 4 : null; // pro Woche
  const rate7 = m?.bewerbungen_7t ?? null;
  if (rate28 != null && rate28 >= 1 && rate7 != null && rate7 < 0.5 * rate28) push(gelb, 'einbruch', `Bewerbungen −${Math.round((1 - rate7 / rate28) * 100)}% (7T vs. 28T)`);
  if (m?.budget_prozent != null && m.budget_prozent >= 80) push(gelb, 'budget', `Budget ${m.budget_prozent}%`);

  let ampel;
  if (rot.length) ampel = 'rot';
  else if (gelb.length) ampel = 'gelb';
  else if (m && (lauftage > 0 || bew != null)) ampel = 'gruen';
  else ampel = 'grau';
  return { ampel, ampel_gruende: gruende };
}

export const AMPEL_RANG = { rot: 0, gelb: 1, gruen: 2, grau: 3 };
