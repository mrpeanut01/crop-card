-- Phase 8a left a stale FK on `spray_events.sprayer_id` pointing at the
-- write-frozen `sprayers` table. Every new spray record fails the FK check
-- because sprayer writes go to `equipment` now (UC-02 CT-001 from
-- 2026-05-24 clickthrough). insecticide_events and fungicide_events were
-- already fixed during their own migrations; spray_events was missed.
--
-- This migration:
--   1. Backfills `equipment` + `equipment_state` from any legacy `sprayers`
--      row that isn't already represented in equipment. Necessary so the
--      new FK constraint doesn't reject pre-Phase-8a spray_events rows.
--   2. Rebuilds `spray_events` with FOREIGN KEY(sprayer_id) → equipment(id).

-- 1. Backfill missing equipment rows.
INSERT INTO `equipment` (`id`, `owner_id`, `type`, `label`)
SELECT `s`.`id`, `s`.`owner_id`, 'sprayer', `s`.`label`
FROM `sprayers` `s`
WHERE NOT EXISTS (SELECT 1 FROM `equipment` `e` WHERE `e`.`id` = `s`.`id`);
--> statement-breakpoint
INSERT INTO `equipment_state` (
  `equipment_id`, `owner_id`, `last_chemistry_class`, `last_used_at`,
  `last_decon_at`, `calibrated_gpa`, `calibration_date`
)
SELECT `s`.`id`, `s`.`owner_id`, `s`.`last_chemistry_class`, `s`.`last_sprayed_at`,
       `s`.`last_decon_at`, `s`.`calibrated_gpa`, `s`.`calibration_date`
FROM `sprayers` `s`
WHERE NOT EXISTS (SELECT 1 FROM `equipment_state` `es` WHERE `es`.`equipment_id` = `s`.`id`);
--> statement-breakpoint

-- 2. Table-rebuild spray_events with corrected FK target.
CREATE TABLE `__new_spray_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`block_id` text NOT NULL,
	`crop_id` text,
	`sprayer_id` text NOT NULL,
	`performed_by_id` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`products_json` text NOT NULL,
	`conditions_json` text NOT NULL,
	`rules_version` text NOT NULL,
	`plugin_hashes_json` text NOT NULL,
	`custom_rate_override` integer DEFAULT false NOT NULL,
	`locked_at` integer,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`crop_id`) REFERENCES `crops`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sprayer_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`performed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_spray_events`(
  "id", "owner_id", "block_id", "crop_id", "sprayer_id", "performed_by_id",
  "occurred_at", "products_json", "conditions_json", "rules_version",
  "plugin_hashes_json", "custom_rate_override", "locked_at"
)
SELECT "id", "owner_id", "block_id", "crop_id", "sprayer_id", "performed_by_id",
       "occurred_at", "products_json", "conditions_json", "rules_version",
       "plugin_hashes_json", "custom_rate_override", "locked_at" FROM `spray_events`;
--> statement-breakpoint
DROP TABLE `spray_events`;
--> statement-breakpoint
ALTER TABLE `__new_spray_events` RENAME TO `spray_events`;
--> statement-breakpoint
CREATE INDEX `spray_events_owner_occurred_idx` ON `spray_events` (`owner_id`,`occurred_at`);
--> statement-breakpoint
CREATE INDEX `spray_events_owner_block_idx` ON `spray_events` (`owner_id`,`block_id`);
