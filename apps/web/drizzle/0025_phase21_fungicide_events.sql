CREATE TABLE `fungicide_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`block_id` text NOT NULL,
	`crop_id` text,
	`sprayer_id` text,
	`performed_by_id` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`products_json` text NOT NULL,
	`scout_observation_json` text,
	`conditions_json` text NOT NULL,
	`re_entry_clear_at` integer,
	`pre_harvest_clear_at` integer,
	`rules_version` text NOT NULL,
	`plugin_hashes_json` text NOT NULL,
	`locked_at` integer,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`crop_id`) REFERENCES `crops`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sprayer_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`performed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `fungicide_events_owner_occurred_idx` ON `fungicide_events` (`owner_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `fungicide_events_owner_block_idx` ON `fungicide_events` (`owner_id`,`block_id`);--> statement-breakpoint
ALTER TABLE `stock_movements` ADD `fungicide_event_id` text REFERENCES fungicide_events(id);
