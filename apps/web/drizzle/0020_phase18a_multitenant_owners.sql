CREATE TABLE `helper_assignments` (
	`owner_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role_within_owner` text NOT NULL,
	`invited_by_user_id` text,
	`accepted_at` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`owner_id`, `user_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `owners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invited_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `helper_assignments_user_idx` ON `helper_assignments` (`user_id`);--> statement-breakpoint
CREATE TABLE `helper_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`email_hash` text NOT NULL,
	`token_hash` text NOT NULL,
	`role_within_owner` text DEFAULT 'helper' NOT NULL,
	`invited_by_user_id` text,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `owners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invited_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `helper_invites_owner_idx` ON `helper_invites` (`owner_id`);--> statement-breakpoint
CREATE INDEX `helper_invites_token_idx` ON `helper_invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `helper_invites_email_idx` ON `helper_invites` (`email_hash`);--> statement-breakpoint
CREATE TABLE `owner_subscriptions` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`plan_code` text DEFAULT 'free' NOT NULL,
	`status` text DEFAULT 'trial' NOT NULL,
	`period_start` integer,
	`period_end` integer,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `owners`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `owner_usage_counters` (
	`owner_id` text NOT NULL,
	`period_yyyymm` integer NOT NULL,
	`ai_calls` integer DEFAULT 0 NOT NULL,
	`storage_bytes` integer DEFAULT 0 NOT NULL,
	`spray_events_count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`owner_id`, `period_yyyymm`),
	FOREIGN KEY (`owner_id`) REFERENCES `owners`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `owners` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`billing_status` text DEFAULT 'trial' NOT NULL,
	`plugin_overrides_revision` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `owners_slug_unique` ON `owners` (`slug`);--> statement-breakpoint
CREATE TABLE `plugin_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text,
	`plugin_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload_json` text NOT NULL,
	`hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `plugin_overrides_owner_plugin_idx` ON `plugin_overrides` (`owner_id`,`plugin_id`);--> statement-breakpoint
CREATE TABLE `superadmin_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`superadmin_user_id` text NOT NULL,
	`action` text NOT NULL,
	`owner_id` text,
	`target_table` text,
	`target_id` text,
	`payload_json` text,
	`at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`superadmin_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_app_settings` (
	`owner_id` text,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`owner_id`, `key`)
);
--> statement-breakpoint
INSERT INTO `__new_app_settings`("owner_id", "key", "value", "updated_at") SELECT NULL, "key", "value", "updated_at" FROM `app_settings`;--> statement-breakpoint
DROP TABLE `app_settings`;--> statement-breakpoint
ALTER TABLE `__new_app_settings` RENAME TO `app_settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `ai_call_log` ADD `owner_id` text;--> statement-breakpoint
CREATE INDEX `ai_call_log_owner_created_idx` ON `ai_call_log` (`owner_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `blocks` ADD `owner_id` text;--> statement-breakpoint
CREATE INDEX `blocks_owner_name_idx` ON `blocks` (`owner_id`,`name`);--> statement-breakpoint
CREATE INDEX `blocks_owner_field_idx` ON `blocks` (`owner_id`,`field_id`);--> statement-breakpoint
ALTER TABLE `crop_equipment` ADD `owner_id` text;--> statement-breakpoint
CREATE INDEX `crop_equipment_owner_crop_idx` ON `crop_equipment` (`owner_id`,`crop_id`);--> statement-breakpoint
ALTER TABLE `crops` ADD `owner_id` text;--> statement-breakpoint
CREATE INDEX `crops_owner_block_idx` ON `crops` (`owner_id`,`block_id`);--> statement-breakpoint
CREATE INDEX `crops_owner_status_idx` ON `crops` (`owner_id`,`status`);--> statement-breakpoint
ALTER TABLE `equipment` ADD `owner_id` text;--> statement-breakpoint
CREATE INDEX `equipment_owner_type_idx` ON `equipment` (`owner_id`,`type`);--> statement-breakpoint
ALTER TABLE `equipment_log` ADD `owner_id` text;--> statement-breakpoint
CREATE INDEX `equipment_log_owner_equip_idx` ON `equipment_log` (`owner_id`,`equipment_id`,`occurred_at`);--> statement-breakpoint
ALTER TABLE `equipment_state` ADD `owner_id` text;--> statement-breakpoint
CREATE INDEX `equipment_state_owner_idx` ON `equipment_state` (`owner_id`);--> statement-breakpoint
ALTER TABLE `fertility_applications` ADD `owner_id` text;--> statement-breakpoint
CREATE INDEX `fertility_applications_owner_block_idx` ON `fertility_applications` (`owner_id`,`block_id`);--> statement-breakpoint
ALTER TABLE `fertility_credits` ADD `owner_id` text;--> statement-breakpoint
CREATE INDEX `fertility_credits_owner_block_year_idx` ON `fertility_credits` (`owner_id`,`block_id`,`applies_to_year`);--> statement-breakpoint
ALTER TABLE `fields` ADD `owner_id` text;--> statement-breakpoint
CREATE INDEX `fields_owner_idx` ON `fields` (`owner_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `harvest_events` ADD `owner_id` text;--> statement-breakpoint
CREATE INDEX `harvest_events_owner_occurred_idx` ON `harvest_events` (`owner_id`,`occurred_at`);--> statement-breakpoint
ALTER TABLE `hay_cuttings` ADD `owner_id` text;--> statement-breakpoint
CREATE INDEX `hay_cuttings_owner_block_year_idx` ON `hay_cuttings` (`owner_id`,`block_id`,`year`);--> statement-breakpoint
ALTER TABLE `insecticide_events` ADD `owner_id` text;--> statement-breakpoint
CREATE INDEX `insecticide_events_owner_occurred_idx` ON `insecticide_events` (`owner_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `insecticide_events_owner_block_idx` ON `insecticide_events` (`owner_id`,`block_id`);--> statement-breakpoint
ALTER TABLE `pending_calibrations` ADD `owner_id` text;--> statement-breakpoint
CREATE INDEX `pending_calibrations_owner_idx` ON `pending_calibrations` (`owner_id`);--> statement-breakpoint
ALTER TABLE `shade_sources` ADD `owner_id` text;--> statement-breakpoint
CREATE INDEX `shade_sources_owner_idx` ON `shade_sources` (`owner_id`);--> statement-breakpoint
ALTER TABLE `soil_tests` ADD `owner_id` text;--> statement-breakpoint
CREATE INDEX `soil_tests_owner_block_idx` ON `soil_tests` (`owner_id`,`block_id`);--> statement-breakpoint
ALTER TABLE `spray_events` ADD `owner_id` text;--> statement-breakpoint
CREATE INDEX `spray_events_owner_occurred_idx` ON `spray_events` (`owner_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `spray_events_owner_block_idx` ON `spray_events` (`owner_id`,`block_id`);--> statement-breakpoint
ALTER TABLE `sprayers` ADD `owner_id` text;--> statement-breakpoint
CREATE INDEX `sprayers_owner_idx` ON `sprayers` (`owner_id`);--> statement-breakpoint
ALTER TABLE `stock_items` ADD `owner_id` text;--> statement-breakpoint
-- Note: active_ingredients_json + formulation_json were added in 0019; drizzle-kit
-- regenerates them here because the 0019 snapshot is missing from drizzle/meta/.
-- Omitting those two ALTERs from this migration.
CREATE INDEX `stock_items_owner_category_idx` ON `stock_items` (`owner_id`,`category`);--> statement-breakpoint
CREATE INDEX `stock_items_owner_plugin_idx` ON `stock_items` (`owner_id`,`plugin_id`);--> statement-breakpoint
CREATE INDEX `stock_items_owner_barcode_idx` ON `stock_items` (`owner_id`,`barcode`);--> statement-breakpoint
ALTER TABLE `stock_lots` ADD `owner_id` text;--> statement-breakpoint
CREATE INDEX `stock_lots_owner_item_idx` ON `stock_lots` (`owner_id`,`stock_item_id`);--> statement-breakpoint
CREATE INDEX `stock_lots_owner_expiry_idx` ON `stock_lots` (`owner_id`,`expires_at`);--> statement-breakpoint
ALTER TABLE `stock_movements` ADD `owner_id` text;--> statement-breakpoint
CREATE INDEX `stock_movements_owner_lot_idx` ON `stock_movements` (`owner_id`,`stock_lot_id`,`occurred_at`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `owner_id` text;--> statement-breakpoint
CREATE INDEX `tasks_owner_scheduled_idx` ON `tasks` (`owner_id`,`scheduled_for`);--> statement-breakpoint
CREATE INDEX `tasks_owner_crop_idx` ON `tasks` (`owner_id`,`crop_id`);--> statement-breakpoint
ALTER TABLE `taxonomy_terms` ADD `owner_id` text;--> statement-breakpoint
CREATE INDEX `taxonomy_terms_domain_idx` ON `taxonomy_terms` (`domain`);--> statement-breakpoint
CREATE INDEX `taxonomy_terms_owner_domain_idx` ON `taxonomy_terms` (`owner_id`,`domain`);--> statement-breakpoint
ALTER TABLE `users` ADD `is_superadmin` integer DEFAULT false NOT NULL;