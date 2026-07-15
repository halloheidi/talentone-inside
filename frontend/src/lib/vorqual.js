// Standard-Vorqualifizierungs-Felder — Spiegel von backend/vorqualifizierung.js
// (VORQUAL_STANDARD). Dient als Anzeige-Fallback, falls ein Job vorqualifizierung=true
// hat, aber (noch) kein Feld-Set. Beide Listen MÜSSEN synchron gehalten werden.
//
// Bewertung (Sterne) + Notizen sind bewusst NICHT enthalten — die sind eigene feste
// Spalten im Telefonisten-Modus.
export const STANDARD_VORQUAL_FELDER = [
  { name: 'Ausbildung', typ: 'text' },
  { name: 'Alter', typ: 'text' },
  { name: 'Aktuelle Situation', typ: 'text' },
  { name: 'Motivation / Wechselgrund', typ: 'text' },
  { name: 'Gehaltsvorstellung (brutto)', typ: 'text' },
  { name: 'Erreichbarkeit', typ: 'dropdown', optionen: ['Jederzeit', 'Vormittags', 'Mittags', 'Nachmittags', 'Abends'] },
  { name: 'PLZ / Wohnort', typ: 'text' },
  { name: 'Führerschein', typ: 'dropdown', optionen: ['Ja', 'Nein', 'Aktuell nicht'] },
  { name: 'Verfügbarkeit', typ: 'text' },
];

// Effektive Vorqual-Felder eines Jobs: das konfigurierte Set, sonst — wenn
// Vorqualifizierung aktiv aber leer — das Standard-Set als Fallback.
export function effektiveVorqualFelder(job) {
  const felder = Array.isArray(job?.vorqualifizierung_felder)
    ? job.vorqualifizierung_felder.filter(f => f && f.name)
    : [];
  if (felder.length === 0 && job?.vorqualifizierung) return STANDARD_VORQUAL_FELDER;
  return felder;
}
