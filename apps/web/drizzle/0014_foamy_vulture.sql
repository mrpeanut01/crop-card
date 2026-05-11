CREATE TABLE `ai_call_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`endpoint` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`cached_input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`usd_estimate` real DEFAULT 0 NOT NULL,
	`success` integer DEFAULT true NOT NULL,
	`error_class` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `blocks` ADD `east_west_index` integer;--> statement-breakpoint
ALTER TABLE `blocks` ADD `north_south_index` integer;--> statement-breakpoint
ALTER TABLE `blocks` ADD `axes_locked` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `blocks` ADD `sun_exposure` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `user_overridden` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `stale_anchor` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `superseded_by_task_id` text;