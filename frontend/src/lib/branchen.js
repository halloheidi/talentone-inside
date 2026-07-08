// Zentrale Branchen-Auswahl — Slug=Label für neue Optionen, alte Slugs bleiben
// für Rückwärtskompatibilität erhalten (Bestandsdaten in DB).
// Alte Slugs werden im Backend über BRANCHE_LABEL auf ein Anzeige-Label gemappt.

export const BRANCHE_OPTIONS = [
  { value: '',                        label: '— bitte wählen —' },
  { value: 'handwerk',                label: 'Handwerk & Bau' },
  { value: 'pflege',                  label: 'Pflege & Soziales' },
  { value: 'einzelhandel',            label: 'Einzelhandel' },
  { value: 'gastro',                  label: 'Gastronomie & Hotel' },
  { value: 'buero',                   label: 'Büro & Verwaltung' },
  { value: 'logistik',                label: 'Logistik & Transport' },
  { value: 'Industrie & Produktion',  label: 'Industrie & Produktion' },
  { value: 'Kfz & Werkstatt',         label: 'Kfz & Werkstatt' },
  { value: 'IT & Software',           label: 'IT & Software' },
  { value: 'Gesundheit & Medizin',    label: 'Gesundheit & Medizin' },
  { value: 'Elektro & SHK',           label: 'Elektro & SHK' },
  { value: 'Garten- & Landschaftsbau',label: 'Garten- & Landschaftsbau' },
  { value: 'Immobilien',              label: 'Immobilien' },
  { value: 'Finanzen & Versicherung', label: 'Finanzen & Versicherung' },
  { value: 'Energie & Solar',         label: 'Energie & Solar' },
  { value: 'Sicherheit',              label: 'Sicherheit' },
  { value: 'Reinigung & Facility',    label: 'Reinigung & Facility' },
  { value: 'Bildung',                 label: 'Bildung' },
  { value: 'Agentur & Marketing',     label: 'Agentur & Marketing' },
  { value: '__andere__',              label: 'Andere Branche…' },
];

const KNOWN_VALUES = new Set(BRANCHE_OPTIONS.map(o => o.value).filter(v => v && v !== '__andere__'));

// True wenn der Wert nicht in der Auswahl steckt → Freitext-Modus.
export function isCustomBranche(value) {
  if (!value) return false;
  return !KNOWN_VALUES.has(value);
}
