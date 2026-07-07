-- Migration 014: Rückbau der Werbemittel-Quelle-Wahl aus Migration 011.
--
-- Entscheidung: KI-Veredelung ist unser Produktionsstandard und IMMER
-- enthalten (in BEIDEN Marken). Der Fototag ist eine einfache Zusatzoption,
-- keine Alternative.
--
-- Änderungen:
--   - NW-SETUP-CREATIVES: category 'option_setup' → zurück auf 'setup'
--     (Pflichtposition, nicht abwählbar). is_default bleibt true (irrelevant
--     für Kategorie 'setup', weil dort ohnehin immer selektiert).
--   - NW-OPT-PHOTO bleibt option_setup, default aus — unverändert.
--
-- Die Vorqualifizierungs-Änderung aus Migration 011 (NW-MONTHLY-CAMPAIGN
-- 1.490 €, NW-OPT-PREQUALIFY 500 € default-an) bleibt vollständig bestehen.

UPDATE public.talentone_offer_products
SET category = 'setup'
WHERE sku = 'NW-SETUP-CREATIVES';
