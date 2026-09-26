CREATE TABLE `planting_journal` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`crop_id` text NOT NULL,
	`block_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`created_by` text,
	`kind` text NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`photo_ref` text,
	`answer_json` text,
	`provenance` text NOT NULL,
	FOREIGN KEY (`crop_id`) REFERENCES `crops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `planting_journal_owner_crop_created_idx` ON `planting_journal` (`owner_id`,`crop_id`,`created_at`);