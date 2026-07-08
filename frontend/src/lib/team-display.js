// Anzeige-Normalisierung für created_by/uploaded_by/changed_by-Felder.
//
// Backend speichert die Login-E-Mail als Actor — bleibt so (rohe Semantik).
// Für die UI mappen wir E-Mails auf einen konsistenten Anzeigenamen, damit
// Mitarbeiter mit mehreren Auth-Accounts (z. B. @nowagwirth.de + @me.com)
// unter EINER Identität erscheinen.
//
// Bei unbekannten E-Mails → Fallback: die E-Mail selbst zurückgeben.

const EMAIL_TO_NAME = {
  'andrea.saltaleggio@nowagwirth.de': 'Andrea Saltaleggio',
  'johannes.wirth@nowagwirth.de':     'Johannes Wirth',
  'johannes.wirth@me.com':            'Johannes Wirth',
  'laura.mueller@nowagwirth.de':      'Laura Müller',
  'daniel.nowag@nowagwirth.de':       'Daniel Nowag',
};

export function displayNameForEmail(email) {
  if (email == null) return '';
  const key = String(email).trim().toLowerCase();
  if (!key) return '';
  return EMAIL_TO_NAME[key] || email;
}
