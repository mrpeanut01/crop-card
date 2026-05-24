-- Phase 25d (#95) — dedicated scout_observations table.
--
-- Until now scout observations have been recorded only as embedded
-- payloads inside `insecticide_events.scout_observation_json` — fine
-- for the IPM gate's existing read path but it has three limits:
--   1. Pre-spray scouting (Monday count below threshold, no spray Friday)
--      doesn't survive — observation is lost
--   2. Sparkline gaps — the 5-week trap-history sparkline only fires
--      with prior sprays in the bucket
--   3. Single-observation-per-spray — a field walk with 3 pests folds
--      to one row (or three sprays, which is wrong)
--
-- This table fixes those: standalone, tenant-scoped, owned per-observation.
-- The IPM evaluator can read from here as primary + fall back to the
-- legacy embedded payloads (Phase 25d follow-up).

CREATE TABLE IF NOT EXISTS `scout_observations` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `owner_id` TEXT NOT NULL,
  `block_id` TEXT NOT NULL REFERENCES `blocks`(`id`),
  `crop_id` TEXT REFERENCES `crops`(`id`),
  `performed_by_id` TEXT NOT NULL REFERENCES `users`(`id`),
  `pest` TEXT NOT NULL,
  `metric` TEXT NOT NULL,
  `value` REAL NOT NULL,
  `notes` TEXT,
  `occurred_at` INTEGER NOT NULL,
  `created_at` INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `scout_observations_owner_occurred_idx`
  ON `scout_observations` (`owner_id`, `occurred_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `scout_observations_owner_block_idx`
  ON `scout_observations` (`owner_id`, `block_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `scout_observations_owner_pest_metric_idx`
  ON `scout_observations` (`owner_id`, `pest`, `metric`);
