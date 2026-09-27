CREATE TABLE `irrigation_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`field_id` text NOT NULL,
	`block_id` text,
	`occurred_at` integer NOT NULL,
	`duration_min` integer,
	`inches` real,
	`gallons` real,
	`method` text,
	`notes` text,
	`performed_by_id` text,
	`client_record_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`field_id`) REFERENCES `fields`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`performed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `irrigation_events_owner_field_occurred_idx` ON `irrigation_events` (`owner_id`,`field_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `rain_gauge_readings` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`field_id` text NOT NULL,
	`read_at` integer NOT NULL,
	`inches` real NOT NULL,
	`recorded_by_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`field_id`) REFERENCES `fields`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recorded_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `rain_gauge_readings_owner_field_read_idx` ON `rain_gauge_readings` (`owner_id`,`field_id`,`read_at`);