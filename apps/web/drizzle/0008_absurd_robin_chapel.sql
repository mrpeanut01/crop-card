PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_crops` (
	`id` text PRIMARY KEY NOT NULL,
	`block_id` text NOT NULL,
	`crop_plugin_id` text NOT NULL,
	`variety_display_name` text NOT NULL,
	`planting_date` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`harvested_at` integer,
	`archived_at` integer,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_crops`("id", "block_id", "crop_plugin_id", "variety_display_name", "planting_date", "status", "harvested_at", "archived_at") SELECT "id", "block_id", "crop_plugin_id", "variety_display_name", "planting_date", "status", "harvested_at", "archived_at" FROM `crops`;--> statement-breakpoint
DROP TABLE `crops`;--> statement-breakpoint
ALTER TABLE `__new_crops` RENAME TO `crops`;--> statement-breakpoint
PRAGMA foreign_keys=ON;