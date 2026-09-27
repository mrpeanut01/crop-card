CREATE TABLE `ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`category` text,
	`description` text,
	`crop_id` text,
	`block_id` text,
	`field_id` text,
	`animal_id` text,
	`animal_group_id` text,
	`stock_lot_id` text,
	`harvest_event_id` text,
	`enterprise` text,
	`quantity` real,
	`unit` text,
	`provenance` text DEFAULT 'manual' NOT NULL,
	`created_by_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`crop_id`) REFERENCES `crops`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`field_id`) REFERENCES `fields`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`animal_id`) REFERENCES `animals`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`animal_group_id`) REFERENCES `animal_groups`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`stock_lot_id`) REFERENCES `stock_lots`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`harvest_event_id`) REFERENCES `harvest_events`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ledger_entries_owner_occurred_idx` ON `ledger_entries` (`owner_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `ledger_entries_owner_crop_idx` ON `ledger_entries` (`owner_id`,`crop_id`);--> statement-breakpoint
CREATE INDEX `ledger_entries_owner_stock_lot_idx` ON `ledger_entries` (`owner_id`,`stock_lot_id`);