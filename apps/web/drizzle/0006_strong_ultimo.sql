ALTER TABLE `planting_records` RENAME TO `crops`;--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`kind` text NOT NULL,
	`linked_to_task_id` text,
	`crop_id` text,
	`block_id` text,
	`equipment_id` text,
	`scheduled_for` integer NOT NULL,
	`completed_at` integer,
	`aborted_at` integer,
	`abort_reason` text,
	`related_event_table` text,
	`related_event_id` text,
	`plugin_template_key` text,
	`recurrence_json` text,
	`created_by_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`linked_to_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`crop_id`) REFERENCES `crops`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_crops` (
	`id` text PRIMARY KEY NOT NULL,
	`block_id` text NOT NULL,
	`crop_plugin_id` text NOT NULL,
	`variety_display_name` text NOT NULL,
	`planting_date` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`harvested_at` integer,
	`archived_at` integer,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_crops`("id", "block_id", "crop_plugin_id", "variety_display_name", "planting_date", "status", "harvested_at", "archived_at") SELECT "id", "block_id", "crop_plugin_id", "variety_display_name", "planting_date", 'active', NULL, NULL FROM `crops`;--> statement-breakpoint
DROP TABLE `crops`;--> statement-breakpoint
ALTER TABLE `__new_crops` RENAME TO `crops`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `fertility_applications` ADD `crop_id` text REFERENCES crops(id);--> statement-breakpoint
ALTER TABLE `harvest_events` ADD `crop_id` text REFERENCES crops(id);--> statement-breakpoint
ALTER TABLE `hay_cuttings` ADD `crop_id` text REFERENCES crops(id);--> statement-breakpoint
ALTER TABLE `insecticide_events` ADD `crop_id` text REFERENCES crops(id);--> statement-breakpoint
ALTER TABLE `spray_events` ADD `crop_id` text REFERENCES crops(id);