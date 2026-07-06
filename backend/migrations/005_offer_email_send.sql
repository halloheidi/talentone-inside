-- Migration 005: Angebotsversand per E-Mail (Phase 4b).
-- - Zeitstempel & Empfänger am Angebot
-- - Textbausteine offer_email_subject / offer_email_body je Marke
--   (Body kann Platzhalter enthalten: {{ansprechpartner}}, {{stelle}},
--    {{monat_1}}, {{setup}}, {{monatlich}} — vom Backend serverseitig ersetzt.)

ALTER TABLE public.talentone_offers
  ADD COLUMN IF NOT EXISTS sent_at   timestamptz,
  ADD COLUMN IF NOT EXISTS sent_to   text;

INSERT INTO public.talentone_offer_templates (brand, key, text) VALUES
  ('talentone', 'offer_email_subject',
   'Ihr Angebot von TalentOne'),

  ('talentone', 'offer_email_body',
   E'Sehr geehrte Damen und Herren,\n\nvielen Dank für Ihr Vertrauen. Anbei erhalten Sie unser Angebot für Ihre Recruiting-Kampagne.\n\nEckdaten:\n• Setup (einmalig): {{setup}}\n• Servicepauschale (monatlich): {{monatlich}}\n• Monat 1 gesamt: {{monat_1}}\n\nDas vollständige Angebot mit allen Positionen, Garantien und Zahlungsbedingungen finden Sie im PDF-Anhang.\n\nBei Fragen oder Änderungswünschen antworten Sie einfach auf diese E-Mail — wir sind kurzfristig erreichbar.\n\nHerzliche Grüße\nIhr TalentOne-Team'),

  ('nowag_wirth', 'offer_email_subject',
   'Ihr Angebot von Nowag & Wirth'),

  ('nowag_wirth', 'offer_email_body',
   E'Sehr geehrte Damen und Herren,\n\nvielen Dank für das gute Gespräch. Anbei erhalten Sie unser Angebot für Ihre Recruiting-Zusammenarbeit mit Nowag & Wirth.\n\nEckdaten:\n• Setup (einmalig): {{setup}}\n• Servicepauschale (monatlich): {{monatlich}}\n• Monat 1 gesamt: {{monat_1}}\n\nDas vollständige Angebot mit allen Positionen, Erfolgsgarantie und Zahlungsbedingungen finden Sie im PDF-Anhang.\n\nBei Fragen oder Änderungswünschen erreichen Sie mich jederzeit — antworten Sie einfach auf diese E-Mail.\n\nMit besten Grüßen\nIhr Nowag & Wirth-Partnermanager')
ON CONFLICT (brand, key) DO NOTHING;
