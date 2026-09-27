CREATE TABLE `task_time_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`task_id` text,
	`user_id` text,
	`crop_id` text,
	`block_id` text,
	`field_id` text,
	`started_at` integer,
	`minutes` integer NOT NULL,
	`source` text DEFAULT 'task-close' NOT NULL,
	`note` text,
	`client_record_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`crop_id`) REFERENCES `crops`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`field_id`) REFERENCES `fields`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `task_time_entries_owner_task_idx` ON `task_time_entries` (`owner_id`,`task_id`);--> statement-breakpoint
CREATE INDEX `task_time_entries_owner_crop_idx` ON `task_time_entries` (`owner_id`,`crop_id`);--> statement-breakpoint
CREATE INDEX `task_time_entries_owner_user_created_idx` ON `task_time_entries` (`owner_id`,`user_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `assignee_user_id` text REFERENCES users(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `tasks` ADD `assigned_at` integer;--> statement-breakpoint
CREATE INDEX `tasks_owner_assignee_scheduled_idx` ON `tasks` (`owner_id`,`assignee_user_id`,`scheduled_for`);