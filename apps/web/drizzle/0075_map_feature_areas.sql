CREATE TABLE `map_feature_areas` (
	`owner_id` text NOT NULL,
	`feature_id` text NOT NULL,
	`field_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`feature_id`, `field_id`),
	FOREIGN KEY (`feature_id`) REFERENCES `map_features`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`field_id`) REFERENCES `fields`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `map_feature_areas_owner_feature_idx` ON `map_feature_areas` (`owner_id`,`feature_id`);--> statement-breakpoint
CREATE INDEX `map_feature_areas_owner_field_idx` ON `map_feature_areas` (`owner_id`,`field_id`);