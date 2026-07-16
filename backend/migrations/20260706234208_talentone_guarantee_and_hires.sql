ALTER TABLE public.talentone_offers
  ADD COLUMN IF NOT EXISTS guarantee_period_days    integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS campaign_started_at      date,
  ADD COLUMN IF NOT EXISTS hires_target             integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS service_waived_override  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS service_waived_note      text,
  ADD COLUMN IF NOT EXISTS billing_paused_at        timestamptz,
  ADD COLUMN IF NOT EXISTS billing_pause_reason     text;

CREATE TABLE IF NOT EXISTS public.talentone_hires (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id      uuid NOT NULL REFERENCES public.talentone_offers(id) ON DELETE CASCADE,
  position      text,
  hired_at      date NOT NULL DEFAULT CURRENT_DATE,
  note          text,
  mail_sent_at  timestamptz,
  mail_sent_to  text,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.talentone_hires IS
  'Erfasste Einstellungen je Angebot. Die ERSTE Einstellung beendet die servicefreie Phase.';
CREATE INDEX IF NOT EXISTS talentone_hires_offer_idx ON public.talentone_hires (offer_id, hired_at);
ALTER TABLE public.talentone_hires ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_talentone_hires_upd ON public.talentone_hires;
CREATE TRIGGER trg_talentone_hires_upd
  BEFORE UPDATE ON public.talentone_hires
  FOR EACH ROW EXECUTE FUNCTION public.talentone_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.talentone_billing_skip_log (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id               uuid NOT NULL REFERENCES public.talentone_offers(id) ON DELETE CASCADE,
  brand                  text NOT NULL CHECK (brand IN ('talentone','nowag_wirth')),
  period_start           date NOT NULL,
  period_end             date NOT NULL,
  reason                 text NOT NULL CHECK (reason IN (
    'guarantee_no_hire', 'talentone_max_month_reached',
    'service_waived_override', 'campaign_ended', 'other'
  )),
  waived_service_amount  numeric(12,2) NOT NULL DEFAULT 0,
  budget_invoiced        boolean NOT NULL DEFAULT false,
  invoice_id             uuid REFERENCES public.talentone_invoices(id) ON DELETE SET NULL,
  note                   text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (offer_id, period_start)
);
COMMENT ON TABLE public.talentone_billing_skip_log IS
  'Protokoll übersprungener bzw. modifizierter Monatsläufe. Basis für die Controlling-Kennzahl "Garantiekosten" (Phase 7).';
CREATE INDEX IF NOT EXISTS talentone_billing_skip_log_brand_month_idx
  ON public.talentone_billing_skip_log (brand, period_start);
ALTER TABLE public.talentone_billing_skip_log ENABLE ROW LEVEL SECURITY;

INSERT INTO public.talentone_offer_templates (brand, key, text) VALUES
  ('talentone', 'hire_email_subject',
   'Glückwunsch — {{firma}} hat eingestellt 🎉'),
  ('talentone', 'hire_email_body_first',
   E'Sehr geehrte Damen und Herren,\n\nherzlichen Glückwunsch zur ersten Einstellung: {{position}} — eingestellt am {{einstellungsdatum}}!\n\nIhre Kampagne läuft unverändert weiter, damit wir auch die verbleibenden {{einstellungen_ziel}} Positionen zeitnah besetzen. Sie haben weiterhin Zugriff auf Ihr TalentOne-Portal mit allen Bewerbern und den Kampagnen-Status.\n\n{{abrechnung_hinweis}}\n\nDie Kampagne läuft unverändert weiter, bis alle {{einstellungen_ziel}} Positionen besetzt sind.\n\nHerzliche Grüße\nIhr TalentOne-Team'),
  ('talentone', 'hire_email_body_progress',
   E'Sehr geehrte Damen und Herren,\n\nfreut uns, dass wir Ihnen bei der nächsten Einstellung helfen konnten: {{position}} — eingestellt am {{einstellungsdatum}}.\n\nAktueller Stand: {{einstellungen_bisher}} von {{einstellungen_ziel}} Positionen besetzt. Die Kampagne läuft für die verbleibenden Positionen unverändert weiter.\n\nHerzliche Grüße\nIhr TalentOne-Team'),
  ('talentone', 'hire_email_body_complete',
   E'Sehr geehrte Damen und Herren,\n\nherzlichen Glückwunsch — mit der Einstellung von {{position}} am {{einstellungsdatum}} sind alle {{einstellungen_ziel}} Positionen besetzt.\n\n{{abrechnung_hinweis}}\n\nWelche Stelle besetzen wir als Nächstes? Die Einrichtung jeder weiteren Stelle kostet nur {{extra_stelle_preis}} — ein kurzer Anruf oder eine Rückmeldung reicht.\n\nDie Zusammenarbeit ist wie vereinbart jederzeit zum Monatsende anpassbar oder kündbar.\n\nHerzliche Grüße\nIhr TalentOne-Team'),
  ('nowag_wirth', 'hire_email_subject',
   'Glückwunsch — {{firma}} hat eingestellt 🎉'),
  ('nowag_wirth', 'hire_email_body_first',
   E'Sehr geehrte Damen und Herren,\n\nherzlichen Glückwunsch zur ersten Einstellung: {{position}} — eingestellt am {{einstellungsdatum}}!\n\nIhr persönlicher Partnermanager begleitet die Kampagne weiter, damit auch die verbleibenden {{einstellungen_ziel}} Positionen zeitnah besetzt werden. Der Bewerber-Hub und Ihr Zugang zu Kampagnen, Terminen und Partnermanagern bleibt unverändert bestehen.\n\n{{abrechnung_hinweis}}\n\nDie Kampagne läuft unverändert weiter, bis alle {{einstellungen_ziel}} Positionen besetzt sind.\n\nMit besten Grüßen\nIhr Nowag & Wirth-Partnermanager'),
  ('nowag_wirth', 'hire_email_body_progress',
   E'Sehr geehrte Damen und Herren,\n\nfreut uns, dass wir Ihnen bei der nächsten Einstellung helfen konnten: {{position}} — eingestellt am {{einstellungsdatum}}.\n\nAktueller Stand: {{einstellungen_bisher}} von {{einstellungen_ziel}} Positionen besetzt. Die Kampagne läuft für die verbleibenden Positionen unverändert weiter.\n\nMit besten Grüßen\nIhr Nowag & Wirth-Partnermanager'),
  ('nowag_wirth', 'hire_email_body_complete',
   E'Sehr geehrte Damen und Herren,\n\nherzlichen Glückwunsch — mit der Einstellung von {{position}} am {{einstellungsdatum}} sind alle {{einstellungen_ziel}} Positionen besetzt.\n\n{{abrechnung_hinweis}}\n\nWelche Stelle besetzen wir als Nächstes? Die Einrichtung jeder weiteren Stelle kostet nur {{extra_stelle_preis}} — Ihr Partnermanager stimmt sich gerne kurz mit Ihnen ab.\n\nDie Zusammenarbeit ist wie vereinbart jederzeit zum Monatsende anpassbar oder kündbar.\n\nMit besten Grüßen\nIhr Nowag & Wirth-Partnermanager')
ON CONFLICT (brand, key) DO NOTHING;

UPDATE public.talentone_offer_templates
SET text = 'Unsere Bewerbungsgarantie: Erhalten Sie innerhalb der ersten {{garantie_frist}} Tage Kampagnenlaufzeit weniger als [X] qualifizierte Bewerbungen, verlängern wir die Kampagnenbetreuung ohne weitere Servicegebühr um bis zu 30 weitere Tage. Das Werbebudget läuft in diesem Zeitraum regulär weiter.'
WHERE brand = 'talentone' AND key = 'guarantee';

UPDATE public.talentone_offer_templates
SET text = 'Rundum-sorglos-Kampagne mit Erfolgsgarantie: Falls nach {{garantie_frist}} Tagen Kampagnenlaufzeit noch keine Einstellung erfolgt ist, arbeitet Nowag & Wirth ohne weitere Servicegebühr weiter, solange die Zusammenarbeit besteht, bis die erste Einstellung erfolgreich abgeschlossen ist. Das Werbebudget läuft in diesem Zeitraum regulär weiter. Die Erfolgsgarantie setzt eine partnerschaftliche Mitwirkung voraus: Kontaktaufnahme mit vermittelten Bewerbern innerhalb von 48 Stunden, kurze Rückmeldung an Ihren Partnermanager nach jedem geführten Gespräch sowie marktübliche Konditionen für die ausgeschriebene Stelle. So stellen wir gemeinsam sicher, dass qualifizierte Bewerber nicht zwischenzeitlich anderweitig unterschreiben.'
WHERE brand = 'nowag_wirth' AND key = 'guarantee';

UPDATE public.talentone_offer_templates
SET text = 'Die Zahlung ist 7 Tage nach Rechnungsstellung fällig. Die monatliche Zusammenarbeit ist jederzeit zum Monatsende kündbar. Die Aussteuerung der Kampagnen erfolgt über Ihr eigenes Meta-Werbekonto; das Werbebudget entrichten Sie unmittelbar an den Werbeplattformbetreiber (Empfehlung: täglich 20–40 € pro Stelle).'
WHERE brand = 'nowag_wirth' AND key = 'payment_terms';
