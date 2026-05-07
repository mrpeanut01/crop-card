CREATE TABLE `fertility_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`block_id` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`source` text NOT NULL,
	`stock_item_id` text,
	`rate_per_acre_hundredths` integer NOT NULL,
	`rate_unit` text NOT NULL,
	`n_delivered_hundredths` integer DEFAULT 0 NOT NULL,
	`p_delivered_hundredths` integer DEFAULT 0 NOT NULL,
	`k_delivered_hundredths` integer DEFAULT 0 NOT NULL,
	`performed_by_id` text,
	`notes` text,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stock_item_id`) REFERENCES `stock_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`performed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `fertility_credits` (
	`id` text PRIMARY KEY NOT NULL,
	`block_id` text NOT NULL,
	`applies_to_year` integer NOT NULL,
	`source` text NOT NULL,
	`crop_plugin_id` text,
	`n_lb_per_acre_hundredths` integer DEFAULT 0 NOT NULL,
	`p_lb_per_acre_hundredths` integer DEFAULT 0 NOT NULL,
	`k_lb_per_acre_hundredths` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `insecticide_events` (
	`id` text PRIMARY KEY NOT NULL,
	`block_id` text NOT NULL,
	`sprayer_id` text,
	`performed_by_id` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`products_json` text NOT NULL,
	`scout_observation_json` text,
	`conditions_json` text NOT NULL,
	`re_entry_clear_at` integer,
	`pre_harvest_clear_at` integer,
	`rules_version` text NOT NULL,
	`plugin_hashes_json` text NOT NULL,
	`locked_at` integer,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sprayer_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`performed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `soil_tests` (
	`id` text PRIMARY KEY NOT NULL,
	`block_id` text NOT NULL,
	`sampled_at` integer NOT NULL,
	`lab` text,
	`report_pdf_url` text,
	`ph_hundredths` integer,
	`cec_hundredths` integer,
	`organic_matter_pct_hundredths` integer,
	`nitrate_ppm` integer,
	`phosphorus_ppm` integer,
	`potassium_ppm` integer,
	`notes` text,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `blocks` ADD `geometry_geojson` text;--> statement-breakpoint
ALTER TABLE `stock_movements` ADD `insecticide_event_id` text REFERENCES insecticide_events(id);--> statement-breakpoint
ALTER TABLE `stock_movements` ADD `fertility_application_id` text REFERENCES fertility_applications(id);