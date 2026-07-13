// Zentraler Katalog der Termin-Arten mit Calendly-Links pro Person.
// Erweiterbar durch neuen Eintrag in TERMINE + optional daniel/johannes-Feld.
// Wird sowohl vom Backend (Endpoint-Validierung + Mail-Betreff) als auch
// vom Frontend (Modal-Options) genutzt — daher als reines Datenobjekt.

export const TERMINE = {
  jour_fixe: {
    label: 'Jour Fixe — aktuellen Stand besprechen',
    subject: 'Kurzer Jour Fixe? 📅',
    intro: 'wie läuft alles bei euch? Lass uns kurz den aktuellen Stand besprechen — 20-30 Minuten reichen, dann sind wir wieder auf einem Stand.',
    daniel: 'https://calendly.com/danielnowag/jour-fixe',
    johannes: 'https://calendly.com/nowag-wirth2/jour-fixe',
  },
  onboarding_abgeschlossen: {
    label: 'Onboarding abgeschlossen',
    subject: 'Onboarding-Abschluss — kurzer Termin 📅',
    intro: 'wir haben dein Onboarding fertig — lass uns kurz gemeinsam durchgehen, was passiert, damit du weißt, was als nächstes kommt.',
    daniel: 'https://calendly.com/danielnowag/onboardingclose',
    johannes: 'https://calendly.com/nowag-wirth2/onboardingclose',
  },
  entwuerfe: {
    label: 'Besprechung der Entwürfe',
    subject: 'Lass uns deine Entwürfe besprechen 📅',
    intro: 'deine Entwürfe sind fertig — statt Feedback nur schriftlich zu klären, gehen wir das gemeinsam kurz durch. Dauert ca. 20 Minuten.',
    daniel: 'https://calendly.com/danielnowag/drafts',
  },
  go_live: {
    label: 'Go-Live',
    subject: 'Dein Go-Live Termin 🚀',
    intro: 'wir sind bereit für den Go-Live! Lass uns einen kurzen Termin machen, damit wir gemeinsam live schalten und du bei allen wichtigen Punkten dabei bist.',
    johannes: 'https://calendly.com/nowag-wirth2/go-live',
  },
  meta_einrichtung: {
    label: 'Meta Einrichtung',
    subject: 'Termin Meta-Einrichtung 📅',
    intro: 'für die technische Meta-Einrichtung brauchen wir ca. 30 Minuten mit dir gemeinsam. Bitte such dir einen Termin aus:',
    johannes: 'https://calendly.com/nowag-wirth2/meta-einrichtung',
  },
};

const PERSONEN_LABEL = { daniel: 'Daniel', johannes: 'Johannes' };

export function verfuegbarePersonen(terminKey) {
  const cfg = TERMINE[terminKey];
  if (!cfg) return [];
  const out = [];
  for (const key of ['daniel', 'johannes']) {
    if (cfg[key]) out.push({ key, label: PERSONEN_LABEL[key], url: cfg[key] });
  }
  return out;
}

export function getTerminMeta(terminKey, personKey) {
  const cfg = TERMINE[terminKey];
  if (!cfg) return null;
  const url = cfg[personKey];
  if (!url) return null;
  return {
    key: terminKey,
    label: cfg.label,
    subject: cfg.subject,
    intro: cfg.intro,
    person: personKey,
    personLabel: PERSONEN_LABEL[personKey] || personKey,
    url,
  };
}
