CREATE TABLE `ledger_entry_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`action` text NOT NULL,
	`changed_by_id` text,
	`changed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`before_json` text,
	`after_json` text,
	FOREIGN KEY (`entry_id`) REFERENCES `ledger_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`changed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ledger_entry_changes_owner_entry_idx` ON `ledger_entry_changes` (`owner_id`,`entry_id`,`changed_at`);