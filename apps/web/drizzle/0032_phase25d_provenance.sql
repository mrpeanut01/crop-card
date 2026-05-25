-- Phase 25d (#89) — v2 AI-provenance layer + dry-run kernel window.
-- See docs/design/almanac/AI_PROVENANCE_ADDENDUM.md.
--
-- Rolls in #93 (ai_call_log provenance fields) and #87 step 6
-- (kernel_dry_run_log table).

-- 1. users.ai_enabled — drives AI-on vs AI-off variant rendering on
--    every screen. Defaults false; flips true when the user validates
--    a Claude API key in Settings → AI.
ALTER TABLE `users` ADD COLUMN `ai_enabled` INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint

-- 2. Per-field provenance on operational event tables. Single JSON
--    column per table keyed by field name; values are objects
--    {source, detail?, confidence?, fallbackReason?, attemptedAiAt?}.
--    Lighter than N columns per pre-populated field; queryable via
--    json_extract; matches the addendum's `provenance | *_provenance`
--    flexibility clause.
ALTER TABLE `spray_events` ADD COLUMN `provenance_json` TEXT;
--> statement-breakpoint
ALTER TABLE `insecticide_events` ADD COLUMN `provenance_json` TEXT;
--> statement-breakpoint
ALTER TABLE `fungicide_events` ADD COLUMN `provenance_json` TEXT;
--> statement-breakpoint
ALTER TABLE `harvest_events` ADD COLUMN `provenance_json` TEXT;
--> statement-breakpoint

-- 3. ai_call_log additions (#93). Every row is either ai or fallback;
--    fallback rows carry the reason + the timestamp the (failed) AI
--    call was attempted, so a later /api/audit/re-ask-ai flow can
--    re-run them.
ALTER TABLE `ai_call_log` ADD COLUMN `provenance` TEXT;
--> statement-breakpoint
ALTER TABLE `ai_call_log` ADD COLUMN `confidence` REAL;
--> statement-breakpoint
ALTER TABLE `ai_call_log` ADD COLUMN `fallback_reason` TEXT;
--> statement-breakpoint
ALTER TABLE `ai_call_log` ADD COLUMN `attempted_ai_at` INTEGER;
--> statement-breakpoint

-- 4. kernel_dry_run_log — Phase 25c.0 step 6 (#87). When KERNEL_DRY_RUN=1
--    the new 25d evaluators (fracRotation, ipmThreshold, pollinatorBloom)
--    write their verdicts here INSTEAD of failing the spray. After a
--    14-day window of clean rows the flag flips off and gates go live.
CREATE TABLE IF NOT EXISTS `kernel_dry_run_log` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `owner_id` TEXT NOT NULL,
  `rules_version` TEXT NOT NULL,
  `evaluator` TEXT NOT NULL,
  `verdict` TEXT NOT NULL,
  `reasons_json` TEXT NOT NULL,
  `planned_spray_json` TEXT NOT NULL,
  `block_id` TEXT,
  `created_at` INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `kernel_dry_run_log_owner_created_idx`
  ON `kernel_dry_run_log` (`owner_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `kernel_dry_run_log_owner_evaluator_idx`
  ON `kernel_dry_run_log` (`owner_id`, `evaluator`);
