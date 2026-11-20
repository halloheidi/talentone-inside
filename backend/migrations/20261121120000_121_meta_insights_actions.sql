-- 121: Rohe Event-/Conversion-Daten je Insight-Tag speichern.
-- Bisher wurden leads/results nur aus 4 engen action_types abgeleitet und waren
-- bei App-/Registration-/Custom-Conversions immer NULL. Jetzt wird das volle
-- actions[]-Array von Meta als jsonb abgelegt; leads/results werden aus einer
-- breiteren Menge relevanter Typen summiert (siehe backend/meta-sync.js).
alter table talentone_meta_insights
  add column if not exists actions jsonb;

alter table talentone_meta_adset_insights
  add column if not exists actions jsonb;

comment on column talentone_meta_insights.actions is
  'Rohes Meta actions[] je Tag: [{action_type, value}, …]. leads = Summe relevanter Conversion-Typen.';
