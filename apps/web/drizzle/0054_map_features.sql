CREATE TABLE `map_features` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`field_id` text,
	`kind` text NOT NULL,
	`geometry_geojson` text NOT NULL,
	`name` text NOT NULL,
	`details_json` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`field_id`) REFERENCES `fields`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `map_features_owner_kind_idx` ON `map_features` (`owner_id`,`kind`);--> statement-breakpoint
CREATE INDEX `map_features_owner_field_idx` ON `map_features` (`owner_id`,`field_id`);