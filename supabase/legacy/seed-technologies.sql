-- supabase/seed-technologies.sql
-- Seed the R&D tech tree catalog for Cycle 14. Safe to re-run.

INSERT INTO technologies (name, era, research_cost_ap, research_cost_budget, duration_days, prerequisite)
SELECT 'PROPULSI CAIR TAHAP I (LOX/RP-1)', 'TIER 01', 5, 10, 7, ARRAY[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM technologies WHERE name = 'PROPULSI CAIR TAHAP I (LOX/RP-1)');

INSERT INTO technologies (name, era, research_cost_ap, research_cost_budget, duration_days, prerequisite)
SELECT 'TELEMETRI DUA ARAH & RADAR', 'TIER 01', 6, 12, 7, ARRAY[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM technologies WHERE name = 'TELEMETRI DUA ARAH & RADAR');

INSERT INTO technologies (name, era, research_cost_ap, research_cost_budget, duration_days, prerequisite)
SELECT 'KAPSUL DUA AWAK VALORIA-MKII', 'TIER 02', 5, 10, 14, ARRAY['PROPULSI CAIR TAHAP I (LOX/RP-1)']::text[]
WHERE NOT EXISTS (SELECT 1 FROM technologies WHERE name = 'KAPSUL DUA AWAK VALORIA-MKII');

INSERT INTO technologies (name, era, research_cost_ap, research_cost_budget, duration_days, prerequisite)
SELECT 'STAGE SEPARATION & ULLAGE ROCKETS', 'TIER 02', 8, 15, 14, ARRAY['PROPULSI CAIR TAHAP I (LOX/RP-1)']::text[]
WHERE NOT EXISTS (SELECT 1 FROM technologies WHERE name = 'STAGE SEPARATION & ULLAGE ROCKETS');

INSERT INTO technologies (name, era, research_cost_ap, research_cost_budget, duration_days, prerequisite)
SELECT 'CRYOGENIC HYDROGEN STAGE (LH2/LOX)', 'TIER 03', 10, 25, 21, ARRAY['STAGE SEPARATION & ULLAGE ROCKETS']::text[]
WHERE NOT EXISTS (SELECT 1 FROM technologies WHERE name = 'CRYOGENIC HYDROGEN STAGE (LH2/LOX)');

INSERT INTO technologies (name, era, research_cost_ap, research_cost_budget, duration_days, prerequisite)
SELECT 'HEAT SHIELD ABLATIF KECEPATAN BULAN', 'TIER 04', 9, 22, 21, ARRAY['KAPSUL DUA AWAK VALORIA-MKII']::text[]
WHERE NOT EXISTS (SELECT 1 FROM technologies WHERE name = 'HEAT SHIELD ABLATIF KECEPATAN BULAN');
