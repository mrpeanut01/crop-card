CREATE TABLE `equipment_water_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`equipment_id` text NOT NULL,
	`field_id` text NOT NULL,
	`block_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`field_id`) REFERENCES `fields`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `equipment_water_targets_owner_target_uq` ON `equipment_water_targets` (`owner_id`,`equipment_id`,`field_id`,`block_id`);--> statement-breakpoint
CREATE INDEX `equipment_water_targets_owner_field_idx` ON `equipment_water_targets` (`owner_id`,`field_id`);--> statement-breakpoint
CREATE TABLE `irrigation_skips` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`equipment_id` text NOT NULL,
	`scheduled_at` integer NOT NULL,
	`reason` text NOT NULL,
	`notes` text,
	`client_record_id` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `irrigation_skips_owner_equipment_scheduled_idx` ON `irrigation_skips` (`owner_id`,`equipment_id`,`scheduled_at`);