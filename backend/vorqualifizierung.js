// Standard-Vorqualifizierungs-Felder. Single Source of Truth für:
//  - KI-Vorschlag (routes/bewerbungen.js) — wird um branchenspezifische Felder ergänzt
//  - Aktivierung des Flags (routes/jobs.js) — direkt geschrieben, damit nie ein
//    leeres Vorqual-Grid entsteht
//  - Backfill-Migration (migrations/032_vorqual_standard_backfill.sql)
//
// Das Frontend spiegelt diese Liste in frontend/src/lib/vorqual.js (Fallback bei
// leerem Feld-Set) — beide MÜSSEN synchron gehalten werden.
//
// Hinweis: Bewertung (Sterne) und Notizen sind KEINE Vorqual-Felder, sondern
// eigene feste Spalten im Telefonisten-Modus — hier bewusst nicht enthalten.
export const VORQUAL_STANDARD = [
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
// Spiegel von frontend/src/lib/vorqual.js:effektiveVorqualFelder.
export function effektiveVorqualFelder(job) {
  const felder = Array.isArray(job?.vorqualifizierung_felder)
    ? job.vorqualifizierung_felder.filter(f => f && f.name)
    : [];
  if (felder.length === 0 && job?.vorqualifizierung) return VORQUAL_STANDARD;
  return felder;
}
