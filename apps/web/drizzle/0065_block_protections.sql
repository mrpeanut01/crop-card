CREATE TABLE `block_protections` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`block_id` text NOT NULL,
	`kind` text NOT NULL,
	`spring_shift_days` integer,
	`fall_shift_days` integer,
	`provenance` text NOT NULL,
	`installed_on` integer,
	`removed_on` integer,
	`season_year` integer,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `block_protections_owner_block_idx` ON `block_protections` (`owner_id`,`block_id`);