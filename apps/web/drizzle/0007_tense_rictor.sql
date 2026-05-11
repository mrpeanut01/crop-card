CREATE TABLE `crop_equipment` (
	`id` text PRIMARY KEY NOT NULL,
	`crop_id` text NOT NULL,
	`equipment_id` text NOT NULL,
	`role` text NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`crop_id`) REFERENCES `crops`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `fields` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`acres` integer,
	`location` text,
	`notes` text,
	`geometry_geojson` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tasks` (
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
	FOREIGN KEY (`crop_id`) REFERENCES `crops`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_tasks`("id", "title", "body", "kind", "linked_to_task_id", "crop_id", "block_id", "equipment_id", "scheduled_for", "completed_at", "aborted_at", "abort_reason", "related_event_table", "related_event_id", "plugin_template_key", "recurrence_json", "created_by_id", "created_at") SELECT "id", "title", "body", "kind", "linked_to_task_id", "crop_id", "block_id", "equipment_id", "scheduled_for", "completed_at", "aborted_at", "abort_reason", "related_event_table", "related_event_id", "plugin_template_key", "recurrence_json", "created_by_id", "created_at" FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `blocks` ADD `field_id` text REFERENCES fields(id);--> statement-breakpoint
ALTER TABLE `stock_movements` ADD `crop_id` text REFERENCES crops(id);