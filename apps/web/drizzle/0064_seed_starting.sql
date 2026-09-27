CREATE TABLE `seed_starts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`crop_id` text NOT NULL,
	`sown_at` integer NOT NULL,
	`tray_label` text,
	`cells` integer,
	`seeds_per_cell` integer,
	`location_area_id` text,
	`location_text` text,
	`stock_lot_id` text,
	`germinated_count` integer,
	`germinated_at` integer,
	`harden_started_at` integer,
	`transplanted_at` integer,
	`performed_by_id` text,
	`client_record_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`crop_id`) REFERENCES `crops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`location_area_id`) REFERENCES `fields`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`stock_lot_id`) REFERENCES `stock_lots`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`performed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `seed_starts_owner_crop_idx` ON `seed_starts` (`owner_id`,`crop_id`);--> statement-breakpoint
CREATE INDEX `seed_starts_owner_sown_idx` ON `seed_starts` (`owner_id`,`sown_at`);--> statement-breakpoint
ALTER TABLE `crops` ADD `establishment` text;--> statement-breakpoint
ALTER TABLE `crops` ADD `sown_indoors_at` integer;