-- Funnel-Typ: explizite Auswahl statt Auto-Anlage eines internen Funnels.
-- null = Alt-Bestand / noch nicht gewählt (Frontend behandelt null wie 'intern',
-- solange ein Funnel-Row existiert). Werte: 'perspective' | 'onepage' | 'intern'.
ALTER TABLE talentone_funnels ADD COLUMN IF NOT EXISTS funnel_typ text;
