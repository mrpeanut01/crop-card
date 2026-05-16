-- Phase 18a — backfill the legacy single-farm data into a "Home Farm" Owner.
--
-- After 0020, every tenant-scoped table carries a nullable owner_id. Before
-- 0022 flips owner_id to NOT NULL, every existing row must be stamped with
-- the Home Farm owner and every existing user must have a helper_assignments
-- row pointing at it. This migration is idempotent via INSERT OR IGNORE so
-- re-running on a partially-migrated DB is safe.
--
-- The Home Farm id is deterministic ('owner_home_farm') so application code
-- can detect "this is the legacy tenant" if needed during the transition.

INSERT OR IGNORE INTO `owners` (`id`, `name`, `slug`, `billing_status`, `plugin_overrides_revision`, `created_at`)
VALUES ('owner_home_farm', 'Home Farm', 'home-farm', 'active', 0, unixepoch() * 1000);
--> statement-breakpoint

-- Seed a free-plan subscription so billing-suspended gates don't trip post-migration.
INSERT OR IGNORE INTO `owner_subscriptions` (`owner_id`, `plan_code`, `status`, `created_at`, `updated_at`)
VALUES ('owner_home_farm', 'free', 'active', unixepoch() * 1000, unixepoch() * 1000);
--> statement-breakpoint

-- Promote every existing user to a Home Farm assignment. The legacy
-- users.role column maps 1:1 to roleWithinOwner; later migrations drop
-- users.role once helper_assignments is the source of truth.
INSERT OR IGNORE INTO `helper_assignments` (
  `owner_id`, `user_id`, `role_within_owner`, `accepted_at`, `status`, `created_at`
)
SELECT 'owner_home_farm', `id`, `role`, unixepoch() * 1000, 'active', unixepoch() * 1000
FROM `users`;
--> statement-breakpoint

-- Stamp every tenant-scoped row with the Home Farm owner. Order doesn't
-- matter (no FK between owner_id and the rows here); doing them as a batch
-- keeps the migration readable.
UPDATE `fields` SET `owner_id` = 'owner_home_farm' WHERE `owner_id` IS NULL;--> statement-breakpoint
UPDATE `blocks` SET `owner_id` = 'owner_home_farm' WHERE `owner_id` IS NULL;--> statement-breakpoint
UPDATE `shade_sources` SET `owner_id` = 'owner_home_farm' WHERE `owner_id` IS NULL;--> statement-breakpoint
UPDATE `crops` SET `owner_id` = 'owner_home_farm' WHERE `owner_id` IS NULL;--> statement-breakpoint
UPDATE `crop_equipment` SET `owner_id` = 'owner_home_farm' WHERE `owner_id` IS NULL;--> statement-breakpoint
UPDATE `sprayers` SET `owner_id` = 'owner_home_farm' WHERE `owner_id` IS NULL;--> statement-breakpoint
UPDATE `spray_events` SET `owner_id` = 'owner_home_farm' WHERE `owner_id` IS NULL;--> statement-breakpoint
UPDATE `harvest_events` SET `owner_id` = 'owner_home_farm' WHERE `owner_id` IS NULL;--> statement-breakpoint
UPDATE `equipment` SET `owner_id` = 'owner_home_farm' WHERE `owner_id` IS NULL;--> statement-breakpoint
UPDATE `equipment_state` SET `owner_id` = 'owner_home_farm' WHERE `owner_id` IS NULL;--> statement-breakpoint
UPDATE `equipment_log` SET `owner_id` = 'owner_home_farm' WHERE `owner_id` IS NULL;--> statement-breakpoint
UPDATE `pending_calibrations` SET `owner_id` = 'owner_home_farm' WHERE `owner_id` IS NULL;--> statement-breakpoint
UPDATE `stock_items` SET `owner_id` = 'owner_home_farm' WHERE `owner_id` IS NULL;--> statement-breakpoint
UPDATE `stock_lots` SET `owner_id` = 'owner_home_farm' WHERE `owner_id` IS NULL;--> statement-breakpoint
UPDATE `stock_movements` SET `owner_id` = 'owner_home_farm' WHERE `owner_id` IS NULL;--> statement-breakpoint
UPDATE `soil_tests` SET `owner_id` = 'owner_home_farm' WHERE `owner_id` IS NULL;--> statement-breakpoint
UPDATE `fertility_applications` SET `owner_id` = 'owner_home_farm' WHERE `owner_id` IS NULL;--> statement-breakpoint
UPDATE `fertility_credits` SET `owner_id` = 'owner_home_farm' WHERE `owner_id` IS NULL;--> statement-breakpoint
UPDATE `insecticide_events` SET `owner_id` = 'owner_home_farm' WHERE `owner_id` IS NULL;--> statement-breakpoint
UPDATE `hay_cuttings` SET `owner_id` = 'owner_home_farm' WHERE `owner_id` IS NULL;--> statement-breakpoint
UPDATE `tasks` SET `owner_id` = 'owner_home_farm' WHERE `owner_id` IS NULL;--> statement-breakpoint
UPDATE `ai_call_log` SET `owner_id` = 'owner_home_farm' WHERE `owner_id` IS NULL;--> statement-breakpoint
-- app_settings already rebuilt with composite PK in 0020; rows preserved with NULL owner_id, fix now.
UPDATE `app_settings` SET `owner_id` = 'owner_home_farm' WHERE `owner_id` IS NULL;--> statement-breakpoint
-- taxonomy_terms: leave system defaults (is_default=1) with NULL owner_id (globally visible);
-- only stamp user-added terms.
UPDATE `taxonomy_terms` SET `owner_id` = 'owner_home_farm' WHERE `owner_id` IS NULL AND `is_default` = 0;
