// Team-Mitglieder für @-Mention-Auswahl und E-Mail-Benachrichtigung.
// role: 'admin' → Zugriff auf Admin-Bereiche (Angebots-Katalog, Preisverwaltung).
// Bei neuen Kolleg:innen hier ergänzen.

export const TEAM_MEMBERS = [
  { name: 'Andrea S.',    email: 'andrea.saltaleggio@nowagwirth.de', role: 'admin' },
  { name: 'Johannes W.',  email: 'johannes.wirth@nowagwirth.de',     role: 'admin' },
  // Zweit-Account, mit dem Johannes ebenfalls in Supabase Auth registriert
  // ist — beide Adressen führen zur selben Person, deshalb beide als Admin.
  { name: 'Johannes W.',  email: 'johannes.wirth@me.com',            role: 'admin' },
  { name: 'Laura M.',     email: 'laura.mueller@nowagwirth.de',      role: 'team'  },
  { name: 'Daniel N.',    email: 'daniel.nowag@nowagwirth.de',       role: 'admin' },
];

export function findMemberByName(name) {
  if (!name) return null;
  return TEAM_MEMBERS.find(m => m.name === name) || null;
}

export function findMemberByEmail(email) {
  if (!email) return null;
  const needle = String(email).trim().toLowerCase();
  return TEAM_MEMBERS.find(m => m.email.toLowerCase() === needle) || null;
}

export function isAdminEmail(email) {
  const m = findMemberByEmail(email);
  return m?.role === 'admin';
}
