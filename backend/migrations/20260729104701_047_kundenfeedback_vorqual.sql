-- Vom Kunden gepflegte Vorqual-/Kriterien-Werte (getrennt von den internen
-- Recruiter-Werten in talentone_bewerber_notizen, damit sich Kunde und Team
-- nicht gegenseitig ueberschreiben). Keyed nach Feldname.
alter table talentone_bewerber_kundenfeedback
  add column if not exists vorqual_werte_kunde jsonb not null default '{}'::jsonb;

comment on column talentone_bewerber_kundenfeedback.vorqual_werte_kunde is 'Vom Kunden ergaenzte Vorqual-/Kriterien-Werte {feldname: wert}. Ueberschreibt NICHT die internen Recruiter-Werte; wird in der Kunden-Ansicht mit "vom Kunden"-Badge gezeigt.';
