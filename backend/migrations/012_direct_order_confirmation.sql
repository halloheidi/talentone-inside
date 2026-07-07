-- Migration 012: Direkt-Auftragsbestätigung aus dem Wizard.
--   - Zeitstempel + Empfänger fürs AB-Mail-Log
--   - Textbausteine order_email_subject / order_email_body je Marke
--   Merge-Tags wie beim Angebot: {{ansprechpartner}}, {{firma}},
--   {{setup}}, {{monatlich}}, {{monat_1}}, {{werbebudget}}.

ALTER TABLE public.talentone_offers
  ADD COLUMN IF NOT EXISTS order_sent_at   timestamptz,
  ADD COLUMN IF NOT EXISTS order_sent_to   text;

INSERT INTO public.talentone_offer_templates (brand, key, text) VALUES
  ('talentone', 'order_email_subject',
   'Ihre Auftragsbestätigung von TalentOne'),

  ('talentone', 'order_email_body',
   E'Hallo {{ansprechpartner}},\n\nvielen Dank für Ihren Auftrag — wir freuen uns auf die Zusammenarbeit! Anbei erhalten Sie die verbindliche Auftragsbestätigung im PDF-Anhang.\n\nEckdaten Ihres Auftrags:\n• Setup (einmalig): {{setup}}\n• Servicepauschale (monatlich): {{monatlich}}\n• Monat 1 gesamt: {{monat_1}}\n\nSo geht es weiter: Wir melden uns in den nächsten Werktagen für den Onboarding-Termin und schalten Sie im Kunden-Portal frei. Die Setup-Rechnung senden wir Ihnen ebenfalls kurzfristig zu — Kampagnenstart erfolgt nach Zahlungseingang.\n\nBei Fragen antworten Sie einfach auf diese E-Mail.\n\nHerzliche Grüße\nIhr TalentOne-Team'),

  ('nowag_wirth', 'order_email_subject',
   'Ihre Auftragsbestätigung von Nowag & Wirth'),

  ('nowag_wirth', 'order_email_body',
   E'Hallo {{ansprechpartner}},\n\nvielen Dank für den Auftrag und Ihr Vertrauen in Nowag & Wirth. Anbei erhalten Sie die verbindliche Auftragsbestätigung als PDF-Anhang.\n\nEckdaten Ihres Auftrags:\n• Setup (einmalig): {{setup}}\n• Servicepauschale (monatlich): {{monatlich}}\n• Monat 1 gesamt: {{monat_1}}\n\nSo geht es weiter: Ihr persönlicher Partnermanager meldet sich kurzfristig für das Onboarding-Gespräch und die Freischaltung Ihres Zugangs. Die Setup-Rechnung folgt separat.\n\nBei Fragen erreichen Sie mich jederzeit — antworten Sie einfach auf diese E-Mail.\n\nMit besten Grüßen\nIhr Nowag & Wirth-Partnermanager')
ON CONFLICT (brand, key) DO NOTHING;
