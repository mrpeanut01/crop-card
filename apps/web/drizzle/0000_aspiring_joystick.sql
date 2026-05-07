CREATE TABLE `blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`acres` integer,
	`block_label` text
);
--> statement-breakpoint
CREATE TABLE `harvest_events` (
	`id` text PRIMARY KEY NOT NULL,
	`block_id` text NOT NULL,
	`crop_plugin_id` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`quantity` text,
	`lot_number` text,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `planting_records` (
	`id` text PRIMARY KEY NOT NULL,
	`block_id` text NOT NULL,
	`crop_plugin_id` text NOT NULL,
	`variety_display_name` text NOT NULL,
	`planting_date` integer NOT NULL,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `spray_events` (
	`id` text PRIMARY KEY NOT NULL,
	`block_id` text NOT NULL,
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
	FOREIGN KEY (`sprayer_id`) REFERENCES `sprayers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`performed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sprayers` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`calibrated_gpa` integer,
	`calibration_date` integer,
	`last_chemistry_class` text,
	`last_sprayed_at` integer,
	`last_decon_at` integer
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'helper' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);