CREATE TABLE `hay_cuttings` (
	`id` text PRIMARY KEY NOT NULL,
	`block_id` text NOT NULL,
	`crop_plugin_id` text NOT NULL,
	`cutting_number` integer NOT NULL,
	`year` integer NOT NULL,
	`status` text DEFAULT 'mowing' NOT NULL,
	`mow_at` integer,
	`ted_at` integer,
	`rake_at` integer,
	`bale_at` integer,
	`stored_at` integer,
	`bale_type` text,
	`bales_quantity` integer,
	`bale_moisture_hundredths` integer,
	`weather_forecast_json` text,
	`performed_by_id` text,
	`rules_version` text NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`performed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `weather_forecast_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`cache_key` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`payload_json` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weather_forecast_cache_cache_key_unique` ON `weather_forecast_cache` (`cache_key`);