UPDATE public.talentone_offer_templates
SET text = E'Hallo {{ansprechpartner}},\n\nvielen Dank für Ihren Auftrag — wir freuen uns auf die Zusammenarbeit! Anbei erhalten Sie die verbindliche Auftragsbestätigung im PDF-Anhang.\n\n{{eckdaten}}\n\nSo geht es weiter: Wir melden uns in den nächsten Werktagen für den Onboarding-Termin und schalten Sie im Kunden-Portal frei.\n\nDie Setup-Rechnung senden wir Ihnen ebenfalls kurzfristig zu — Kampagnenstart erfolgt nach Zahlungseingang.\n\nBei Fragen antworten Sie einfach auf diese E-Mail.\n\nHerzliche Grüße\nIhr TalentOne-Team'
WHERE brand = 'talentone' AND key = 'order_email_body';

UPDATE public.talentone_offer_templates
SET text = E'Hallo {{ansprechpartner}},\n\nvielen Dank für den Auftrag und Ihr Vertrauen in Nowag & Wirth. Anbei erhalten Sie die verbindliche Auftragsbestätigung als PDF-Anhang.\n\n{{eckdaten}}\n\nSo geht es weiter: Ihr persönlicher Partnermanager meldet sich kurzfristig für das Onboarding-Gespräch und die Freischaltung Ihres Zugangs.\n\nDie Setup-Rechnung folgt separat.\n\nBei Fragen erreichen Sie mich jederzeit — antworten Sie einfach auf diese E-Mail.\n\nMit besten Grüßen\nIhr Nowag & Wirth-Partnermanager'
WHERE brand = 'nowag_wirth' AND key = 'order_email_body';

INSERT INTO public.talentone_offer_templates (brand, key, text) VALUES
  ('talentone',   'onboarding_form_url', ''),
  ('nowag_wirth', 'onboarding_form_url', '')
ON CONFLICT (brand, key) DO NOTHING;
