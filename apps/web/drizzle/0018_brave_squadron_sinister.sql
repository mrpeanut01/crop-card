CREATE TABLE `shade_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'tree-row' NOT NULL,
	`geometry_geojson` text,
	`field_id` text,
	`height_ft` real NOT NULL,
	`opacity` real DEFAULT 0.7 NOT NULL,
	`is_deciduous` integer DEFAULT false NOT NULL,
	`leaf_on_day_of_year` integer DEFAULT 105 NOT NULL,
	`leaf_off_day_of_year` integer DEFAULT 305 NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`field_id`) REFERENCES `fields`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `blocks` ADD `slope_percent` real;--> statement-breakpoint
ALTER TABLE `blocks` ADD `slope_aspect_deg` real;