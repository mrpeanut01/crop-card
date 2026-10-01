CREATE TABLE `harvest_dispositions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`harvest_event_id` text NOT NULL,
	`kind` text NOT NULL,
	`quantity_hundredths` integer NOT NULL,
	`unit` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`recipient` text,
	`sold_as_organic` integer,
	`ledger_entry_id` text,
	`client_record_id` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`locked_at` integer,
	FOREIGN KEY (`harvest_event_id`) REFERENCES `harvest_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ledger_entry_id`) REFERENCES `ledger_entries`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `harvest_dispositions_owner_harvest_idx` ON `harvest_dispositions` (`owner_id`,`harvest_event_id`);--> statement-breakpoint
CREATE INDEX `harvest_dispositions_owner_occurred_idx` ON `harvest_dispositions` (`owner_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `organic_status_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`status` text NOT NULL,
	`effective_at` integer NOT NULL,
	`certifier` text,
	`note` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `organic_status_events_owner_subject_effective_idx` ON `organic_status_events` (`owner_id`,`subject_type`,`subject_id`,`effective_at`);--> statement-breakpoint
CREATE TABLE `organic_treatment_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`health_event_id` text NOT NULL,
	`outcome` text NOT NULL,
	`reason` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`locked_at` integer,
	FOREIGN KEY (`health_event_id`) REFERENCES `animal_health_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organic_treatment_reviews_owner_health_event_uq` ON `organic_treatment_reviews` (`owner_id`,`health_event_id`);--> statement-breakpoint
ALTER TABLE `stock_lots` ADD `seed_organic_status` text;--> statement-breakpoint
ALTER TABLE `stock_lots` ADD `seed_sources_checked_json` text;--> statement-breakpoint
ALTER TABLE `stock_lots` ADD `seed_unavailability_note` text;