-- Seed der Kunden-Mail-Vorlagen: exakt die bisherigen Hardcoded-Texte, je Du-/Sie-
-- Fassung, je einmal für talentone und nowagwirth. Der Wortlaut ist byte-identisch
-- zum Code-Default (der weiterhin als Fallback dient) — das Versand-Verhalten bleibt
-- nach der Migration exakt gleich, nur eben DB-gesteuert.
--
-- {{platzhalter}} werden vom Service (email-templates.js) mit denselben dynamischen
-- Werten ersetzt, die der Code interpoliert. ON CONFLICT DO NOTHING: bereits
-- vorhandene (ggf. manuell editierte) Vorlagen werden NIE überschrieben.
--
-- Verzweigte Mails (upload_anfrage, formular_einladung) sind hier mit ihrer
-- Standard-Variante geseedet (Logo+Fotos bzw. Recruiting); die übrigen Varianten
-- behalten ihren exakten Code-Text. Nur-Betreff-Vorlagen (portal_zugang,
-- avv_bestaetigung, entwurf_runde, kampagne_update) haben body_* = NULL, der Body
-- bleibt strukturell im Code.

WITH tpl(key, name, beschreibung, betreff_du, betreff_sie, body_du, body_sie, platzhalter) AS (
  VALUES
    ('daten_pruefung',
      'Daten-Prüfung',
      'An den Kunden: bitte die erfassten Stellendaten prüfen/ergänzen (POST /jobs/:id/send-pruefung). customText aus dem Modal überschreibt den Body.',
      'Bitte kurz prüfen: die Angaben zu deiner Stelle',
      'Bitte kurz prüfen: die Angaben zu Ihrer Stelle',
      E'wir haben die Informationen zu deiner Stelle {{stelle_txt}} bereits zusammengetragen. Schau einmal drüber, ob alles stimmt — du kannst direkt ergänzen oder korrigieren.',
      E'wir haben die Informationen zu Ihrer Stelle {{stelle_txt}} bereits zusammengetragen. Schauen Sie einmal drüber, ob alles stimmt — Sie können direkt ergänzen oder korrigieren.',
      '["stelle_txt","stelle"]'::jsonb),

    ('feedback_anfrage',
      'Feedback-Anfrage (wöchentlich)',
      'CRON: wöchentliche Zufriedenheits-Anfrage an live TalentOne-Kunden (weekly-feedback.js).',
      'Kurzes Feedback zu deiner Kampagne?',
      'Kurzes Feedback zu Ihrer Kampagne?',
      E'deine Kampagne läuft jetzt seit {{tage_txt}} — wie zufrieden bist du bisher? Dein kurzes Feedback hilft uns, die Kampagne weiter zu optimieren (dauert keine 60 Sekunden).',
      E'Ihre Kampagne läuft jetzt seit {{tage_txt}} — wie zufrieden sind Sie bisher? Ihr kurzes Feedback hilft uns, die Kampagne weiter zu optimieren (dauert keine 60 Sekunden).',
      '["tage_txt","live_tage"]'::jsonb),

    ('avv_anfrage',
      'AVV-Anfrage',
      'An den Kunden: AVV bestätigen (POST /kunden/:id/avv-anfrage). customText überschreibt den Body.',
      'Bitte noch bestätigen: Auftragsverarbeitungsvertrag (AVV)',
      'Bitte noch bestätigen: Auftragsverarbeitungsvertrag (AVV)',
      E'für unsere Zusammenarbeit fehlt noch die Bestätigung des Auftragsverarbeitungsvertrags (AVV) — datenschutzrechtlich sind wir dazu verpflichtet. Über den Button unten kannst du den Vertrag ansehen und mit einem Klick im Namen von {{firma_du}} akzeptieren.',
      E'für unsere Zusammenarbeit fehlt noch die Bestätigung des Auftragsverarbeitungsvertrags (AVV) — datenschutzrechtlich sind wir dazu verpflichtet. Über den Button unten können Sie den Vertrag ansehen und mit einem Klick im Namen von {{firma_sie}} akzeptieren.',
      '["firma_du","firma_sie"]'::jsonb),

    ('kriterien_anfrage',
      'Prüf-Kriterien-Anfrage',
      'An den Kunden: Vorqualifizierungs-Kriterien eintragen (POST /jobs/:id/kriterien-anfrage). customText überschreibt den Body.',
      'Worauf sollen wir achten? — {{stelle}}',
      'Worauf sollen wir achten? — {{stelle}}',
      E'wir telefonieren gerade die Bewerber für {{stelle}} vor. Damit wir genau auf das achten, was dir wichtig ist: Was sind deine wichtigsten Kriterien?\n\nÜber den Link unten kannst du sie direkt eintragen — dauert 2 Minuten. Wir prüfen sie dann bei jedem Bewerber systematisch ab.',
      E'wir telefonieren gerade die Bewerber für {{stelle}} vor. Damit wir genau auf das achten, was Ihnen wichtig ist: Was sind Ihre wichtigsten Kriterien?\n\nÜber den Link unten können Sie sie direkt eintragen — dauert 2 Minuten. Wir prüfen sie dann bei jedem Bewerber systematisch ab.',
      '["stelle"]'::jsonb),

    ('entwurf_reminder',
      'Entwurfs-Reminder',
      'An den Kunden: Erinnerung, dass Entwürfe auf Freigabe warten (POST /jobs/:id/export/entwurf-reminder). customText überschreibt den Body.',
      'Kurze Erinnerung: deine Entwürfe warten auf Freigabe',
      'Kurze Erinnerung: deine Entwürfe warten auf Freigabe',
      E'vor ein paar Tagen haben wir dir die Entwürfe für deine Recruiting-Kampagne geschickt. Hast du schon reinschauen können?\n\nDamit wir zeitnah live gehen können, brauchen wir noch dein Feedback:',
      E'vor ein paar Tagen haben wir Ihnen die Entwürfe für Ihre Recruiting-Kampagne geschickt. Hatten Sie schon Gelegenheit reinzuschauen?\n\nDamit wir zeitnah live gehen können, brauchen wir noch Ihr Feedback:',
      '[]'::jsonb),

    ('kampagne_pause',
      'Kampagne pausiert',
      'An den Kunden: Kampagne technisch pausiert (POST /jobs/:id/export/kampagne-pause). customText überschreibt den Body.',
      '⏸ Deine Kampagne ist kurz pausiert',
      '⏸ Deine Kampagne ist kurz pausiert',
      E'{{anrede}},\n\nwir müssen dich kurz informieren: Deine Kampagne ist aktuell aufgrund technischer Probleme pausiert. Wir arbeiten bereits an der Lösung und melden uns, sobald sie wieder live ist.\n\nDie Pausenzeit wird selbstverständlich hinten angehängt — dir entsteht kein Nachteil.',
      E'{{anrede}},\n\nwir müssen Sie kurz informieren: Ihre Kampagne ist aktuell aufgrund technischer Probleme pausiert. Wir arbeiten bereits an der Lösung und melden uns, sobald sie wieder live ist.\n\nDie Pausenzeit wird selbstverständlich hinten angehängt — Ihnen entsteht kein Nachteil.',
      '["anrede"]'::jsonb),

    ('kampagne_live',
      'Kampagne ist live',
      'An den Kunden: Kampagne wurde live geschaltet (POST /jobs/:id/export/kampagne-live). customText überschreibt den Body.',
      '🚀 Deine Kampagne ist live!',
      '🚀 Deine Kampagne ist live!',
      E'{{anrede}},\n\ngute Neuigkeiten — deine Recruiting-Kampagne für {{stelle}} ist ab jetzt online! 🚀\n\nAb sofort erreichen wir potenzielle Bewerber mit deinen Anzeigen. Die ersten Bewerbungen können in den nächsten Tagen reinkommen — du wirst pro Bewerbung automatisch per Mail benachrichtigt.\n\nDu kannst alle eingehenden Bewerbungen jederzeit unter dem Link unten einsehen, ihren Status pflegen und Notizen ergänzen.',
      E'{{anrede}},\n\ngute Neuigkeiten — Ihre Recruiting-Kampagne für {{stelle}} ist ab jetzt online! 🚀\n\nAb sofort erreichen wir potenzielle Bewerber mit Ihren Anzeigen. Die ersten Bewerbungen können in den nächsten Tagen reinkommen — Sie werden pro Bewerbung automatisch per Mail benachrichtigt.\n\nSie können alle eingehenden Bewerbungen jederzeit unter dem Link unten einsehen, ihren Status pflegen und Notizen ergänzen.',
      '["anrede","stelle"]'::jsonb),

    ('reaktivierung',
      'Reaktivierung',
      'An den Kunden: frische KI-Creatives, Angebot zur Reaktivierung (POST /jobs/:id/export/reaktivierung). customText überschreibt den Body. Mittlerer Satz („Unser Vorschlag …") ist bewusst in beiden Fassungen Du-Form (wie bisher im Code).',
      'Frische KI-Werbeanzeigen für {{stelle}} — reaktivieren?',
      'Frische KI-Werbeanzeigen für {{stelle}} — reaktivieren?',
      E'{{anrede}},\n\nwir haben spannende Neuigkeiten: Mit unserer neuen KI-Technologie haben wir frische Werbeanzeigen für deine offene Stelle als {{stelle}} erstellt — und das Ergebnis kann sich sehen lassen!\n\nUnser Vorschlag: Geh nochmal für 30 Tage online — du zahlst nur die Betreuungspauschale, die Erstellung der neuen Creatives ist inklusive.\n\nSollen wir kurz telefonieren? Antworte einfach auf diese Mail oder buch dir direkt einen Termin (unverbindlich): {{cal_link}}',
      E'{{anrede}},\n\nwir haben spannende Neuigkeiten: Mit unserer neuen KI-Technologie haben wir frische Werbeanzeigen für Ihre offene Stelle als {{stelle}} erstellt — und das Ergebnis kann sich sehen lassen!\n\nUnser Vorschlag: Geh nochmal für 30 Tage online — du zahlst nur die Betreuungspauschale, die Erstellung der neuen Creatives ist inklusive.\n\nSollen wir kurz telefonieren? Antworten Sie einfach auf diese Mail oder buchen Sie sich direkt einen Termin (unverbindlich): {{cal_link}}',
      '["anrede","stelle","cal_link"]'::jsonb),

    ('upload_anfrage',
      'Fotos & Logo — Anfrage (Logo + Fotos)',
      'An den Kunden: Materialien hochladen (POST /kunden/:id/anfrage). Diese Vorlage greift für die Standard-Variante „Logo + Fotos"; die Varianten „nur Logo"/„nur Fotos" behalten ihren Code-Text. customText überschreibt den Body.',
      'Wir brauchen noch Logo und Fotos für eure Kampagne',
      'Wir brauchen noch Logo und Fotos für Ihre Kampagne',
      E'wir bereiten gerade eure Recruiting-Kampagne vor und brauchen dafür ein paar Materialien von euch. Über den unten stehenden Link könnt ihr ganz einfach euer Logo und Fotos vom Team / Arbeitsplatz hochladen.',
      E'wir bereiten gerade Ihre Recruiting-Kampagne vor und brauchen dafür ein paar Materialien von Ihnen. Über den unten stehenden Link können Sie ganz einfach Ihr Logo und Fotos vom Team / Arbeitsplatz hochladen.',
      '[]'::jsonb),

    ('formular_einladung',
      'Briefing-Formular-Einladung (Recruiting)',
      'An den Kunden: Briefing-Formular ausfüllen (POST /kunden/formular-anlegen, POST /jobs/quick-create). Diese Vorlage greift für Recruiting-Projekte; Neukundengewinnung behält ihren Code-Text. customText überschreibt den Body. Aufzählung + Tipp bleiben im Code.',
      'Kurzes Briefing-Formular für eure Recruiting-Kampagne',
      'Kurzes Briefing-Formular für Ihre Recruiting-Kampagne',
      E'wir freuen uns auf eure Recruiting-Kampagne! Damit wir starten können, haben wir ein kurzes Briefing-Formular für euch vorbereitet — dort tragt ihr alles rund um eure offene Stelle, eure Benefits und euer Unternehmen ein. Dauert etwa 10 Minuten.',
      E'wir freuen uns auf Ihre Recruiting-Kampagne! Damit wir starten können, haben wir ein kurzes Briefing-Formular für Sie vorbereitet — dort tragen Sie alles rund um Ihre offene Stelle, Ihre Benefits und Ihr Unternehmen ein. Dauert etwa 10 Minuten.',
      '[]'::jsonb),

    ('portal_zugang',
      'Portal-Zugang (Betreff)',
      'An den Kunden: Zugang zum Kunden-Dashboard (POST /kunden/:id/portal-accounts). Nur der Betreff ist als Vorlage editierbar; der strukturierte Body bleibt im Code.',
      'Dein Zugang zum {{portal_name}}-Portal',
      'Ihr Zugang zum {{portal_name}}-Portal',
      NULL,
      NULL,
      '["portal_name"]'::jsonb),

    ('avv_bestaetigung',
      'AVV-Bestätigung (Betreff)',
      'An den Kunden nach AVV-Annahme, mit PDF-Anhang (avv.js). Nur der Betreff ist als Vorlage editierbar; der Body bleibt im Code.',
      'Ihre AVV-Kopie für die Unterlagen ({{agentur_name}})',
      'Ihre AVV-Kopie für die Unterlagen ({{agentur_name}})',
      NULL,
      NULL,
      '["agentur_name","version"]'::jsonb),

    ('entwurf_runde',
      'Entwürfe verschickt (Betreff)',
      'An den Kunden: Entwürfe zur Freigabe (POST /jobs/:id/export/email). Nur der Betreff-Fallback ist als Vorlage editierbar; ein im Modal gesetzter Betreff sowie das KI-Anschreiben haben Vorrang.',
      'Deine Entwürfe sind fertig 🎨',
      'Ihre Entwürfe sind fertig 🎨',
      NULL,
      NULL,
      '["stelle"]'::jsonb),

    ('kampagne_update',
      'Kampagnen-Update (Betreff)',
      'An den Kunden: neue Werbeanzeigen während der Live-Phase (POST /jobs/:id/export/kampagne-update). Nur der Betreff-Fallback ist editierbar; der Route-Betreff „… — Update N" hat Vorrang.',
      'Neue Werbeanzeigen für deine Kampagne 📬',
      'Neue Werbeanzeigen für Ihre Kampagne 📬',
      NULL,
      NULL,
      '["stelle"]'::jsonb)
)
INSERT INTO talentone_email_templates
  (key, agentur, name, beschreibung, betreff_du, betreff_sie, body_du, body_sie, platzhalter, updated_by)
SELECT t.key, a.agentur, t.name, t.beschreibung, t.betreff_du, t.betreff_sie,
       t.body_du, t.body_sie, t.platzhalter, 'seed:058'
FROM tpl t
CROSS JOIN (VALUES ('talentone'), ('nowagwirth')) AS a(agentur)
ON CONFLICT (key, agentur) DO NOTHING;
