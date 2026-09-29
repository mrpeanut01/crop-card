CREATE TABLE `hold_corrections` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`record_kind` text NOT NULL,
	`record_id` text NOT NULL,
	`user_id` text,
	`reason` text NOT NULL,
	`diff_json` text NOT NULL,
	`diff_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `hold_corrections_owner_created_idx` ON `hold_corrections` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `hold_corrections_owner_record_idx` ON `hold_corrections` (`owner_id`,`record_kind`,`record_id`);--> statement-breakpoint
ALTER TABLE `animal_health_events` ADD `hold_params_json` text;--> statement-breakpoint
ALTER TABLE `animal_health_events` ADD `recorded_late` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `animal_locations` ADD `to_recorded_at` integer;--> statement-breakpoint
ALTER TABLE `animal_locations` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `animal_locations` ADD `deleted_by` text;--> statement-breakpoint
ALTER TABLE `animal_locations` ADD `void_reason` text;--> statement-breakpoint
ALTER TABLE `animal_locations` ADD `voided_at` integer;--> statement-breakpoint
ALTER TABLE `animal_production_logs` ADD `recorded_late` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `animal_status_events` ADD `recorded_late` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `fungicide_events` ADD `hold_params_json` text;--> statement-breakpoint
ALTER TABLE `hay_cuttings` ADD `recorded_late` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `insecticide_events` ADD `hold_params_json` text;--> statement-breakpoint
ALTER TABLE `spray_events` ADD `hold_params_json` text;--> statement-breakpoint
UPDATE `animal_health_events` SET `recorded_late` = 1 WHERE `administered_at` < `created_at` - 172800000;--> statement-breakpoint
UPDATE `animal_production_logs` SET `recorded_late` = 1 WHERE `occurred_at` < `created_at` - 172800000;--> statement-breakpoint
UPDATE `animal_status_events` SET `recorded_late` = 1 WHERE `occurred_at` < `created_at` - 172800000;--> statement-breakpoint
UPDATE `hay_cuttings` SET `recorded_late` = 1 WHERE `mow_at` IS NOT NULL AND `mow_at` < `created_at` - 172800000;
