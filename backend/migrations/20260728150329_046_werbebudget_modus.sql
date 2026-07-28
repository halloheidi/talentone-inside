-- Werbebudget-Modus: 'position' (wie bisher, als Position/Durchleitung) oder
-- 'empfehlung' (nicht abgerechnet, nur Empfehlungs-Hinweis; Kunde zahlt direkt).
alter table talentone_offers
  add column if not exists werbebudget_modus text not null default 'position',
  add column if not exists tagesbudget_empfehlung numeric;

alter table talentone_projekte
  add column if not exists werbebudget_modus text,
  add column if not exists tagesbudget_empfehlung numeric;

comment on column talentone_offers.werbebudget_modus is 'position = Werbebudget als Rechnungsposition (Durchleitung); empfehlung = nicht abgerechnet, nur Empfehlungs-Hinweis (Kunde hinterlegt eigenes Zahlungsmittel).';
comment on column talentone_offers.tagesbudget_empfehlung is 'Empfohlenes Tagesbudget in € (nur bei modus=empfehlung).';
comment on column talentone_projekte.werbebudget_modus is 'Aus dem angenommenen Angebot uebernommen: position | empfehlung.';
comment on column talentone_projekte.tagesbudget_empfehlung is 'Empfohlenes Tagesbudget in € (bei empfehlung) — Team hinterlegt Kunden-Zahlungsmittel statt Zahlungslink.';
