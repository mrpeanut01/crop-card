-- CT-S6-004 / #326 — harvest_events gains a stored-moisture column so
-- inspector exports (USDA CSV, VDACS PDF) can surface the moisture % that
-- UC-16 (Sprint 19 harvest-moisture kernel) already validates at record
-- time but never persisted. Stored as hundredths of a percent (integer)
-- to match the codebase convention for fixed-point fractional fields
-- (see soil_tests.ph, fertility_applications.n_delivered_hundredths, and
-- hay_cuttings.bale_moisture_hundredths). Nullable: null means the
-- operator did not capture moisture for this harvest (informational, not
-- a kernel violation).

ALTER TABLE `harvest_events` ADD `moisture_pct_hundredths` integer;
