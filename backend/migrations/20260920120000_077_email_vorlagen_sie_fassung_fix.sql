-- Anrede-Konsistenz: Die Sie-Fassungen dieser Intro-Vorlagen waren fälschlich in
-- Du-Form (Seed 063). Korrigiert. Die Begrüßung ("Hallo …,") setzt der Mail-
-- Renderer zentral aus anrede_form — Vorlagen-Texte tragen keine eigene Anrede.
-- Idempotent.
update talentone_email_templates
  set body_sie = 'Danke für Ihr Feedback! Wir haben die Entwürfe überarbeitet — sehen Sie sie sich an:', updated_at = now()
  where key = 'entwurf_neue_runde';
update talentone_email_templates
  set body_sie = 'Hier nochmal Ihre Entwürfe:', updated_at = now()
  where key = 'entwurf_resend';
update talentone_email_templates
  set body_sie = replace(body_sie,
        'Geh nochmal für 30 Tage online — du zahlst nur die Betreuungspauschale',
        'Gehen Sie nochmal für 30 Tage online — Sie zahlen nur die Betreuungspauschale'),
      updated_at = now()
  where key = 'reaktivierung';
