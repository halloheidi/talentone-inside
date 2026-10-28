// Garantie-Typ (Migration 105): 'einstellung' | 'bewerbungen' | keine.
// garantie (bool) + garantie_details bleiben Alt-/Meta-Felder; der Typ steuert die Anzeige.

export const GARANTIE_ARTEN = [
  { key: '', label: 'Keine Garantie' },
  { key: 'einstellung', label: 'Einstellungsgarantie' },
  { key: 'bewerbungen', label: 'Bewerbungsgarantie' },
];
export const GARANTIE_LABEL = { einstellung: 'Einstellungsgarantie', bewerbungen: 'Bewerbungsgarantie' };

// Effektive Garantie inkl. Legacy-Fallback: garantie=true ohne gesetzten Typ
// → als Einstellungsgarantie behandeln und „prüfen" markieren.
export function effektiveGarantie(p) {
  if (!p) return null;
  const art = p.garantie_art || (p.garantie ? 'einstellung' : null);
  if (!art) return null;
  return {
    art,
    ziel: p.garantie_ziel ?? (art === 'einstellung' ? 1 : null),
    position: p.garantie_position || null,
    pruefen: !!p.garantie_pruefen || (!!p.garantie && !p.garantie_art),
  };
}

// Badge-Text wie spezifiziert.
export function garantieBadge(art, erreicht, ziel) {
  if (art === 'einstellung') return `🛡️ Einstellungsgarantie · ${erreicht ?? 0} von ${ziel ?? 1} eingestellt`;
  if (art === 'bewerbungen') return `🛡️ Garantie · ${erreicht ?? 0} von ${ziel ?? 0} Bewerbungen`;
  return '';
}
