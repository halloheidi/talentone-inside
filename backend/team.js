// Team-Mitglieder für @-Mention-Auswahl und E-Mail-Benachrichtigung.
// Bei neuen Kolleg:innen hier ergänzen.

export const TEAM_MEMBERS = [
  { name: 'Andrea S.',    email: 'andrea.saltaleggio@nowagwirth.de' },
  { name: 'Christian R.', email: 'christian.r@nowagwirth.de' },
  { name: 'Johannes W.',  email: 'johannes.wirth@nowagwirth.de' },
  { name: 'Daniel N.',    email: 'daniel.n@nowagwirth.de' },
  { name: 'Laura M.',     email: 'laura.m@nowagwirth.de' },
];

export function findMemberByName(name) {
  if (!name) return null;
  return TEAM_MEMBERS.find(m => m.name === name) || null;
}
