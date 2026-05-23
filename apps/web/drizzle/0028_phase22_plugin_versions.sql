CREATE TABLE `plugin_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`plugin_id` text NOT NULL,
	`version` text NOT NULL,
	`kind` text NOT NULL,
	`hash` text NOT NULL,
	`payload_json` text NOT NULL,
	`changed_by_user_id` text,
	`change_reason` text,
	`diff_summary_json` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`superseded_at` integer,
	`retired_at` integer,
	FOREIGN KEY (`changed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `plugin_versions_plugin_idx` ON `plugin_versions` (`plugin_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `plugin_versions_hash_idx` ON `plugin_versions` (`plugin_id`,`hash`);