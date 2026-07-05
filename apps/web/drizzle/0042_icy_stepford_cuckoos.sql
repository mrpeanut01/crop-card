CREATE TABLE `season_closeouts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`year` integer NOT NULL,
	`closed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`closed_by_id` text,
	`snapshot_json` text NOT NULL,
	`reopened_at` integer,
	FOREIGN KEY (`closed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `season_closeouts_owner_year_uq` ON `season_closeouts` (`owner_id`,`year`);--> statement-breakpoint
CREATE INDEX `season_closeouts_owner_closed_idx` ON `season_closeouts` (`owner_id`,`closed_at`);