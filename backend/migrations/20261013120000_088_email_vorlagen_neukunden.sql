-- 088 — Neukunden-Varianten kundengerichteter Automatik-Mails.
--
-- Befund: kampagne_live u. a. sprechen hart von „Recruiting-Kampagne"/„Bewerber"/
-- „Bewerbungen" — bei projekttyp=neukundengewinnung (z. B. solar-projects, Sinkfix)
-- falsch. Lösung: je Mail-Typ eine `<key>_neukunden`-Vorlage (Du+Sie). Der Versand
-- wählt die Variante nach job.projekttyp; fehlt die Neukunden-Variante, wird NICHT
-- die Recruiting-Variante gesendet (Fallback-Block im Code).
--
-- Texte byte-identisch zu den Neukunden-Code-Defaults in mail.js / routes/exports.js
-- und zum Katalog email-template-defaults.js. Beide Agenturen (talentone, nowagwirth)
-- via CROSS JOIN. Bereits vorhandene Zeilen bleiben unangetastet (ON CONFLICT).

WITH tpl(key, name, beschreibung, betreff_du, betreff_sie, body_du, body_sie, platzhalter) AS (VALUES
  ('kampagne_live_neukunden', 'Kampagne ist live (Neukundengewinnung)', 'Wie „Kampagne ist live", aber für Neukundengewinnung: neutrale Wortwahl („Anfragen"/„Zielgruppe" statt „Bewerber"/„Bewerbungen"). Greift bei projekttyp=neukundengewinnung (POST /jobs/:id/export/kampagne-live). customText überschreibt den Body.',
    '🚀 Deine Kampagne ist live!', '🚀 Ihre Kampagne ist live!',
    '{{anrede}},

gute Neuigkeiten — deine Kampagne für {{stelle}} ist ab jetzt online! 🚀

Ab sofort erreichen wir deine Zielgruppe mit deinen Anzeigen. Die ersten Anfragen können in den nächsten Tagen eintreffen — du wirst pro Anfrage automatisch per Mail benachrichtigt.

Du kannst alle eingehenden Anfragen jederzeit unter dem Link unten einsehen, ihren Status pflegen und Notizen ergänzen.',
    '{{anrede}},

gute Neuigkeiten — Ihre Kampagne für {{stelle}} ist ab jetzt online! 🚀

Ab sofort erreichen wir Ihre Zielgruppe mit Ihren Anzeigen. Die ersten Anfragen können in den nächsten Tagen eintreffen — Sie werden pro Anfrage automatisch per Mail benachrichtigt.

Sie können alle eingehenden Anfragen jederzeit unter dem Link unten einsehen, ihren Status pflegen und Notizen ergänzen.',
    '["anrede","stelle"]'::jsonb),

  ('kampagne_pause_neukunden', 'Kampagne pausiert (Neukundengewinnung)', 'Wie „Kampagne pausiert", für Neukundengewinnung. Text ist bereits neutral; eigene Vorlage nur zur Projekttyp-Trennung + Fallback-Sicherheit. customText überschreibt den Body.',
    '⏸ Deine Kampagne ist kurz pausiert', '⏸ Ihre Kampagne ist kurz pausiert',
    '{{anrede}},

wir müssen dich kurz informieren: Deine Kampagne ist aktuell aufgrund technischer Probleme pausiert. Wir arbeiten bereits an der Lösung und melden uns, sobald sie wieder live ist.

Die Pausenzeit wird selbstverständlich hinten angehängt — dir entsteht kein Nachteil.',
    '{{anrede}},

wir müssen Sie kurz informieren: Ihre Kampagne ist aktuell aufgrund technischer Probleme pausiert. Wir arbeiten bereits an der Lösung und melden uns, sobald sie wieder live ist.

Die Pausenzeit wird selbstverständlich hinten angehängt — Ihnen entsteht kein Nachteil.',
    '["anrede"]'::jsonb),

  ('kampagne_update_neukunden', 'Kampagnen-Update (Neukundengewinnung)', 'Wie „Kampagnen-Update", für Neukundengewinnung. Text ist bereits neutral; eigene Vorlage nur zur Projekttyp-Trennung + Fallback-Sicherheit. Body = Intro-Satz vor dem KI-Anschreiben.',
    'Neue Werbeanzeigen für deine Kampagne — Update {{runde}} 📬', 'Neue Werbeanzeigen für Ihre Kampagne — Update {{runde}} 📬',
    'wir haben neue Werbeanzeigen für deine Kampagne erstellt, um die Performance weiter zu verbessern. Schau sie dir an und gib sie frei, damit wir sie live schalten können:',
    'wir haben neue Werbeanzeigen für Ihre Kampagne erstellt, um die Performance weiter zu verbessern. Sehen Sie sie sich an und geben Sie sie frei, damit wir sie live schalten können:',
    '["runde","stelle"]'::jsonb),

  ('reaktivierung_neukunden', 'Reaktivierung (Neukundengewinnung)', 'Wie „Reaktivierung", für Neukundengewinnung: „Kampagne {{stelle}}" statt „offene Stelle als {{stelle}}". Mittlerer Satz bewusst in beiden Fassungen Du-Form (wie bisher im Code).',
    'Frische KI-Werbeanzeigen für {{stelle}} — reaktivieren?', 'Frische KI-Werbeanzeigen für {{stelle}} — reaktivieren?',
    '{{anrede}},

wir haben spannende Neuigkeiten: Mit unserer neuen KI-Technologie haben wir frische Werbeanzeigen für deine Kampagne {{stelle}} erstellt — und das Ergebnis kann sich sehen lassen!

Unser Vorschlag: Geh nochmal für 30 Tage online — du zahlst nur die Betreuungspauschale, die Erstellung der neuen Creatives ist inklusive.

Sollen wir kurz telefonieren? Antworte einfach auf diese Mail oder buch dir direkt einen Termin (unverbindlich): {{cal_link}}',
    '{{anrede}},

wir haben spannende Neuigkeiten: Mit unserer neuen KI-Technologie haben wir frische Werbeanzeigen für Ihre Kampagne {{stelle}} erstellt — und das Ergebnis kann sich sehen lassen!

Unser Vorschlag: Gehen Sie nochmal für 30 Tage online — Sie zahlen nur die Betreuungspauschale, die Erstellung der neuen Creatives ist inklusive.

Sollen wir kurz telefonieren? Antworten Sie einfach auf diese Mail oder buchen Sie sich direkt einen Termin (unverbindlich): {{cal_link}}',
    '["anrede","stelle","cal_link"]'::jsonb),

  ('entwurf_reminder_neukunden', 'Entwurfs-Reminder (Neukundengewinnung)', 'Wie „Entwurfs-Reminder", für Neukundengewinnung: „Neukunden-Kampagne" statt „Recruiting-Kampagne". customText überschreibt den Body.',
    'Kurze Erinnerung: deine Entwürfe warten auf Freigabe', 'Kurze Erinnerung: deine Entwürfe warten auf Freigabe',
    'vor ein paar Tagen haben wir dir die Entwürfe für deine Neukunden-Kampagne geschickt. Hast du schon reinschauen können?

Damit wir zeitnah live gehen können, brauchen wir noch dein Feedback:',
    'vor ein paar Tagen haben wir Ihnen die Entwürfe für Ihre Neukunden-Kampagne geschickt. Hatten Sie schon Gelegenheit reinzuschauen?

Damit wir zeitnah live gehen können, brauchen wir noch Ihr Feedback:',
    '[]'::jsonb),

  ('daten_pruefung_neukunden', 'Daten-Prüfung (Neukundengewinnung)', 'Wie „Daten-Prüfung", aber für Neukundengewinnungs-Projekte: Kampagnen-Labels statt „Stelle" (POST /jobs/:id/send-pruefung, projekttyp=neukundengewinnung). customText aus dem Modal überschreibt den Body.',
    'Bitte kurz prüfen: die Angaben zu deiner Kampagne', 'Bitte kurz prüfen: die Angaben zu Ihrer Kampagne',
    'wir haben die Angaben zu deiner Kampagne {{stelle_txt}} bereits zusammengetragen. Schau einmal drüber, ob alles stimmt — du kannst direkt ergänzen oder korrigieren.',
    'wir haben die Angaben zu Ihrer Kampagne {{stelle_txt}} bereits zusammengetragen. Schauen Sie einmal drüber, ob alles stimmt — Sie können direkt ergänzen oder korrigieren.',
    '["stelle_txt","stelle"]'::jsonb)
)
INSERT INTO talentone_email_templates (key, agentur, name, beschreibung, betreff_du, betreff_sie, body_du, body_sie, platzhalter, updated_by)
SELECT t.key, a.agentur, t.name, t.beschreibung, t.betreff_du, t.betreff_sie, t.body_du, t.body_sie, t.platzhalter, 'seed:088'
FROM tpl t CROSS JOIN (VALUES ('talentone'), ('nowagwirth')) AS a(agentur)
ON CONFLICT (key, agentur) DO NOTHING;
