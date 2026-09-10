-- 071: Monatsbudget je Projekt (Budget-Wächter). Spend des laufenden Kalendermonats
-- über die zugeordneten Meta-Kampagnen ÷ monatsbudget_euro = Auslastung. 80%/100%
-- fließen in die tägliche interne Sammel-Mail. Projekte ohne Budget bleiben stumm.
alter table talentone_projekte add column if not exists monatsbudget_euro numeric;
