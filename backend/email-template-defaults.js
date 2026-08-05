// Kanonischer Katalog der Kunden-Mail-Vorlagen.
//
// Quelle der Wahrheit für:
//   - die Admin-Übersicht (Bereich-Gruppierung, name, beschreibung, platzhalter,
//     Nur-Betreff-Kennzeichnung),
//   - die Funktion „Auf Standard zurücksetzen" (schreibt diese Default-Texte
//     zurück in talentone_email_templates).
//
// Die Texte sind byte-identisch zum Code-Default in mail.js / exports.js und zum
// Seed (Migration 058). Der Versand selbst nutzt weiterhin renderEmail() gegen
// die DB; fehlt eine Zeile, greift der Code-Default in der jeweiligen Funktion.
//
// betreffOnly: true → Body wird strukturell/dynamisch im Code erzeugt, nur der
// Betreff ist als Vorlage editierbar (body_du/sie bleiben NULL).

export const EMAIL_TEMPLATE_BEREICHE = [
  { id: 'onboarding', label: 'Onboarding' },
  { id: 'kampagne',   label: 'Kampagne' },
  { id: 'feedback',   label: 'Feedback' },
  { id: 'verwaltung', label: 'Verwaltung' },
];

export const EMAIL_TEMPLATE_CATALOG = [
  // ─────────────── Onboarding ───────────────
  {
    key: 'formular_einladung',
    bereich: 'onboarding',
    betreffOnly: false,
    name: 'Briefing-Formular-Einladung (Recruiting)',
    beschreibung: 'An den Kunden: Briefing-Formular ausfüllen (POST /kunden/formular-anlegen, POST /jobs/quick-create). Diese Vorlage greift für Recruiting-Projekte; Neukundengewinnung behält ihren Code-Text. customText überschreibt den Body. Aufzählung + Tipp bleiben im Code.',
    platzhalter: [],
    betreff_du: 'Kurzes Briefing-Formular für eure Recruiting-Kampagne',
    betreff_sie: 'Kurzes Briefing-Formular für Ihre Recruiting-Kampagne',
    body_du: 'wir freuen uns auf eure Recruiting-Kampagne! Damit wir starten können, haben wir ein kurzes Briefing-Formular für euch vorbereitet — dort tragt ihr alles rund um eure offene Stelle, eure Benefits und euer Unternehmen ein. Dauert etwa 10 Minuten.',
    body_sie: 'wir freuen uns auf Ihre Recruiting-Kampagne! Damit wir starten können, haben wir ein kurzes Briefing-Formular für Sie vorbereitet — dort tragen Sie alles rund um Ihre offene Stelle, Ihre Benefits und Ihr Unternehmen ein. Dauert etwa 10 Minuten.',
  },
  {
    key: 'upload_anfrage',
    bereich: 'onboarding',
    betreffOnly: false,
    name: 'Fotos & Logo — Anfrage (Logo + Fotos)',
    beschreibung: 'An den Kunden: Materialien hochladen (POST /kunden/:id/anfrage). Diese Vorlage greift für die Standard-Variante „Logo + Fotos"; die Varianten „nur Logo"/„nur Fotos" behalten ihren Code-Text. customText überschreibt den Body.',
    platzhalter: [],
    betreff_du: 'Wir brauchen noch Logo und Fotos für eure Kampagne',
    betreff_sie: 'Wir brauchen noch Logo und Fotos für Ihre Kampagne',
    body_du: 'wir bereiten gerade eure Recruiting-Kampagne vor und brauchen dafür ein paar Materialien von euch. Über den unten stehenden Link könnt ihr ganz einfach euer Logo und Fotos vom Team / Arbeitsplatz hochladen.',
    body_sie: 'wir bereiten gerade Ihre Recruiting-Kampagne vor und brauchen dafür ein paar Materialien von Ihnen. Über den unten stehenden Link können Sie ganz einfach Ihr Logo und Fotos vom Team / Arbeitsplatz hochladen.',
  },
  {
    key: 'daten_pruefung',
    bereich: 'onboarding',
    betreffOnly: false,
    name: 'Daten-Prüfung',
    beschreibung: 'An den Kunden: bitte die erfassten Stellendaten prüfen/ergänzen (POST /jobs/:id/send-pruefung). customText aus dem Modal überschreibt den Body.',
    platzhalter: ['stelle_txt', 'stelle'],
    betreff_du: 'Bitte kurz prüfen: die Angaben zu deiner Stelle',
    betreff_sie: 'Bitte kurz prüfen: die Angaben zu Ihrer Stelle',
    body_du: 'wir haben die Informationen zu deiner Stelle {{stelle_txt}} bereits zusammengetragen. Schau einmal drüber, ob alles stimmt — du kannst direkt ergänzen oder korrigieren.',
    body_sie: 'wir haben die Informationen zu Ihrer Stelle {{stelle_txt}} bereits zusammengetragen. Schauen Sie einmal drüber, ob alles stimmt — Sie können direkt ergänzen oder korrigieren.',
  },
  {
    key: 'kriterien_anfrage',
    bereich: 'onboarding',
    betreffOnly: false,
    name: 'Prüf-Kriterien-Anfrage',
    beschreibung: 'An den Kunden: Vorqualifizierungs-Kriterien eintragen (POST /jobs/:id/kriterien-anfrage). customText überschreibt den Body.',
    platzhalter: ['stelle'],
    betreff_du: 'Worauf sollen wir achten? — {{stelle}}',
    betreff_sie: 'Worauf sollen wir achten? — {{stelle}}',
    body_du: 'wir telefonieren gerade die Bewerber für {{stelle}} vor. Damit wir genau auf das achten, was dir wichtig ist: Was sind deine wichtigsten Kriterien?\n\nÜber den Link unten kannst du sie direkt eintragen — dauert 2 Minuten. Wir prüfen sie dann bei jedem Bewerber systematisch ab.',
    body_sie: 'wir telefonieren gerade die Bewerber für {{stelle}} vor. Damit wir genau auf das achten, was Ihnen wichtig ist: Was sind Ihre wichtigsten Kriterien?\n\nÜber den Link unten können Sie sie direkt eintragen — dauert 2 Minuten. Wir prüfen sie dann bei jedem Bewerber systematisch ab.',
  },

  // ─────────────── Kampagne ───────────────
  {
    key: 'entwurf_runde',
    bereich: 'kampagne',
    betreffOnly: true,
    name: 'Entwürfe verschickt (Betreff)',
    beschreibung: 'An den Kunden: Entwürfe zur Freigabe (POST /jobs/:id/export/email). Nur der Betreff-Fallback ist als Vorlage editierbar; ein im Modal gesetzter Betreff sowie das KI-Anschreiben haben Vorrang.',
    platzhalter: ['stelle'],
    betreff_du: 'Deine Entwürfe sind fertig 🎨',
    betreff_sie: 'Ihre Entwürfe sind fertig 🎨',
    body_du: null,
    body_sie: null,
  },
  {
    key: 'kampagne_update',
    bereich: 'kampagne',
    betreffOnly: true,
    name: 'Kampagnen-Update (Betreff)',
    beschreibung: 'An den Kunden: neue Werbeanzeigen während der Live-Phase (POST /jobs/:id/export/kampagne-update). Nur der Betreff-Fallback ist editierbar; der Route-Betreff „… — Update N" hat Vorrang.',
    platzhalter: ['stelle'],
    betreff_du: 'Neue Werbeanzeigen für deine Kampagne 📬',
    betreff_sie: 'Neue Werbeanzeigen für Ihre Kampagne 📬',
    body_du: null,
    body_sie: null,
  },
  {
    key: 'entwurf_reminder',
    bereich: 'kampagne',
    betreffOnly: false,
    name: 'Entwurfs-Reminder',
    beschreibung: 'An den Kunden: Erinnerung, dass Entwürfe auf Freigabe warten (POST /jobs/:id/export/entwurf-reminder). customText überschreibt den Body.',
    platzhalter: [],
    betreff_du: 'Kurze Erinnerung: deine Entwürfe warten auf Freigabe',
    betreff_sie: 'Kurze Erinnerung: deine Entwürfe warten auf Freigabe',
    body_du: 'vor ein paar Tagen haben wir dir die Entwürfe für deine Recruiting-Kampagne geschickt. Hast du schon reinschauen können?\n\nDamit wir zeitnah live gehen können, brauchen wir noch dein Feedback:',
    body_sie: 'vor ein paar Tagen haben wir Ihnen die Entwürfe für Ihre Recruiting-Kampagne geschickt. Hatten Sie schon Gelegenheit reinzuschauen?\n\nDamit wir zeitnah live gehen können, brauchen wir noch Ihr Feedback:',
  },
  {
    key: 'kampagne_live',
    bereich: 'kampagne',
    betreffOnly: false,
    name: 'Kampagne ist live',
    beschreibung: 'An den Kunden: Kampagne wurde live geschaltet (POST /jobs/:id/export/kampagne-live). customText überschreibt den Body.',
    platzhalter: ['anrede', 'stelle'],
    betreff_du: '🚀 Deine Kampagne ist live!',
    betreff_sie: '🚀 Deine Kampagne ist live!',
    body_du: '{{anrede}},\n\ngute Neuigkeiten — deine Recruiting-Kampagne für {{stelle}} ist ab jetzt online! 🚀\n\nAb sofort erreichen wir potenzielle Bewerber mit deinen Anzeigen. Die ersten Bewerbungen können in den nächsten Tagen reinkommen — du wirst pro Bewerbung automatisch per Mail benachrichtigt.\n\nDu kannst alle eingehenden Bewerbungen jederzeit unter dem Link unten einsehen, ihren Status pflegen und Notizen ergänzen.',
    body_sie: '{{anrede}},\n\ngute Neuigkeiten — Ihre Recruiting-Kampagne für {{stelle}} ist ab jetzt online! 🚀\n\nAb sofort erreichen wir potenzielle Bewerber mit Ihren Anzeigen. Die ersten Bewerbungen können in den nächsten Tagen reinkommen — Sie werden pro Bewerbung automatisch per Mail benachrichtigt.\n\nSie können alle eingehenden Bewerbungen jederzeit unter dem Link unten einsehen, ihren Status pflegen und Notizen ergänzen.',
  },
  {
    key: 'kampagne_pause',
    bereich: 'kampagne',
    betreffOnly: false,
    name: 'Kampagne pausiert',
    beschreibung: 'An den Kunden: Kampagne technisch pausiert (POST /jobs/:id/export/kampagne-pause). customText überschreibt den Body.',
    platzhalter: ['anrede'],
    betreff_du: '⏸ Deine Kampagne ist kurz pausiert',
    betreff_sie: '⏸ Deine Kampagne ist kurz pausiert',
    body_du: '{{anrede}},\n\nwir müssen dich kurz informieren: Deine Kampagne ist aktuell aufgrund technischer Probleme pausiert. Wir arbeiten bereits an der Lösung und melden uns, sobald sie wieder live ist.\n\nDie Pausenzeit wird selbstverständlich hinten angehängt — dir entsteht kein Nachteil.',
    body_sie: '{{anrede}},\n\nwir müssen Sie kurz informieren: Ihre Kampagne ist aktuell aufgrund technischer Probleme pausiert. Wir arbeiten bereits an der Lösung und melden uns, sobald sie wieder live ist.\n\nDie Pausenzeit wird selbstverständlich hinten angehängt — Ihnen entsteht kein Nachteil.',
  },
  {
    key: 'reaktivierung',
    bereich: 'kampagne',
    betreffOnly: false,
    name: 'Reaktivierung',
    beschreibung: 'An den Kunden: frische KI-Creatives, Angebot zur Reaktivierung (POST /jobs/:id/export/reaktivierung). customText überschreibt den Body. Mittlerer Satz („Unser Vorschlag …") ist bewusst in beiden Fassungen Du-Form (wie bisher im Code).',
    platzhalter: ['anrede', 'stelle', 'cal_link'],
    betreff_du: 'Frische KI-Werbeanzeigen für {{stelle}} — reaktivieren?',
    betreff_sie: 'Frische KI-Werbeanzeigen für {{stelle}} — reaktivieren?',
    body_du: '{{anrede}},\n\nwir haben spannende Neuigkeiten: Mit unserer neuen KI-Technologie haben wir frische Werbeanzeigen für deine offene Stelle als {{stelle}} erstellt — und das Ergebnis kann sich sehen lassen!\n\nUnser Vorschlag: Geh nochmal für 30 Tage online — du zahlst nur die Betreuungspauschale, die Erstellung der neuen Creatives ist inklusive.\n\nSollen wir kurz telefonieren? Antworte einfach auf diese Mail oder buch dir direkt einen Termin (unverbindlich): {{cal_link}}',
    body_sie: '{{anrede}},\n\nwir haben spannende Neuigkeiten: Mit unserer neuen KI-Technologie haben wir frische Werbeanzeigen für Ihre offene Stelle als {{stelle}} erstellt — und das Ergebnis kann sich sehen lassen!\n\nUnser Vorschlag: Geh nochmal für 30 Tage online — du zahlst nur die Betreuungspauschale, die Erstellung der neuen Creatives ist inklusive.\n\nSollen wir kurz telefonieren? Antworten Sie einfach auf diese Mail oder buchen Sie sich direkt einen Termin (unverbindlich): {{cal_link}}',
  },

  // ─────────────── Feedback ───────────────
  {
    key: 'feedback_anfrage',
    bereich: 'feedback',
    betreffOnly: false,
    name: 'Feedback-Anfrage (wöchentlich)',
    beschreibung: 'CRON: wöchentliche Zufriedenheits-Anfrage an live TalentOne-Kunden (weekly-feedback.js).',
    platzhalter: ['tage_txt', 'live_tage'],
    betreff_du: 'Kurzes Feedback zu deiner Kampagne?',
    betreff_sie: 'Kurzes Feedback zu Ihrer Kampagne?',
    body_du: 'deine Kampagne läuft jetzt seit {{tage_txt}} — wie zufrieden bist du bisher? Dein kurzes Feedback hilft uns, die Kampagne weiter zu optimieren (dauert keine 60 Sekunden).',
    body_sie: 'Ihre Kampagne läuft jetzt seit {{tage_txt}} — wie zufrieden sind Sie bisher? Ihr kurzes Feedback hilft uns, die Kampagne weiter zu optimieren (dauert keine 60 Sekunden).',
  },

  // ─────────────── Verwaltung ───────────────
  {
    key: 'avv_anfrage',
    bereich: 'verwaltung',
    betreffOnly: false,
    name: 'AVV-Anfrage',
    beschreibung: 'An den Kunden: AVV bestätigen (POST /kunden/:id/avv-anfrage). customText überschreibt den Body.',
    platzhalter: ['firma_du', 'firma_sie'],
    betreff_du: 'Bitte noch bestätigen: Auftragsverarbeitungsvertrag (AVV)',
    betreff_sie: 'Bitte noch bestätigen: Auftragsverarbeitungsvertrag (AVV)',
    body_du: 'für unsere Zusammenarbeit fehlt noch die Bestätigung des Auftragsverarbeitungsvertrags (AVV) — datenschutzrechtlich sind wir dazu verpflichtet. Über den Button unten kannst du den Vertrag ansehen und mit einem Klick im Namen von {{firma_du}} akzeptieren.',
    body_sie: 'für unsere Zusammenarbeit fehlt noch die Bestätigung des Auftragsverarbeitungsvertrags (AVV) — datenschutzrechtlich sind wir dazu verpflichtet. Über den Button unten können Sie den Vertrag ansehen und mit einem Klick im Namen von {{firma_sie}} akzeptieren.',
  },
  {
    key: 'avv_bestaetigung',
    bereich: 'verwaltung',
    betreffOnly: true,
    name: 'AVV-Bestätigung (Betreff)',
    beschreibung: 'An den Kunden nach AVV-Annahme, mit PDF-Anhang (avv.js). Nur der Betreff ist als Vorlage editierbar; der Body bleibt im Code.',
    platzhalter: ['agentur_name', 'version'],
    betreff_du: 'Ihre AVV-Kopie für die Unterlagen ({{agentur_name}})',
    betreff_sie: 'Ihre AVV-Kopie für die Unterlagen ({{agentur_name}})',
    body_du: null,
    body_sie: null,
  },
  {
    key: 'portal_zugang',
    bereich: 'verwaltung',
    betreffOnly: true,
    name: 'Portal-Zugang (Betreff)',
    beschreibung: 'An den Kunden: Zugang zum Kunden-Dashboard (POST /kunden/:id/portal-accounts). Nur der Betreff ist als Vorlage editierbar; der strukturierte Body bleibt im Code.',
    platzhalter: ['portal_name'],
    betreff_du: 'Dein Zugang zum {{portal_name}}-Portal',
    betreff_sie: 'Ihr Zugang zum {{portal_name}}-Portal',
    body_du: null,
    body_sie: null,
  },
];

export const EMAIL_TEMPLATE_CATALOG_BY_KEY = Object.fromEntries(
  EMAIL_TEMPLATE_CATALOG.map(t => [t.key, t]),
);

// Beispieldaten für Live-Vorschau + Test-Mail. Der Demo-Kunde „Elektrotechnik
// Sonnberg GmbH" liefert firmenname/ansprechpartner; die {{platzhalter}} werden
// mit realistischen Werten gefüllt (analog zu dem, was die echten Versandstellen
// interpolieren).
export function demoDatenFor(key, kunde, form) {
  const stelle = 'Elektroniker (m/w/d)';
  const stelleTxt = `„${stelle}"`;
  const anredeGruss = form === 'sie'
    ? `Guten Tag ${kunde?.ansprechpartner || ''}`.trim()
    : `Hallo ${(kunde?.ansprechpartner || '').split(' ')[0] || 'zusammen'}`;
  const firma = kunde?.firmenname || 'euer Unternehmen';
  return {
    stelle,
    stelle_txt: stelleTxt,
    anrede: anredeGruss,
    cal_link: 'https://cal.com/nowagwirth/reaktivierung',
    tage_txt: '12 Tagen',
    live_tage: 12,
    firma_du: kunde?.firmenname || 'eurem Unternehmen',
    firma_sie: kunde?.firmenname || 'Ihrem Unternehmen',
    portal_name: form === 'sie' ? 'Nowag & Wirth' : 'TalentOne',
    agentur_name: form === 'sie' ? 'Nowag & Wirth' : 'TalentOne',
    version: '1.0',
  };
}
