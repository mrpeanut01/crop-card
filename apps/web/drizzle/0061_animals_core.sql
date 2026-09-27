CREATE TABLE `animal_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`species_id` text NOT NULL,
	`purpose` text DEFAULT 'production' NOT NULL,
	`head_count` integer,
	`housing_field_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`housing_field_id`) REFERENCES `fields`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `animal_groups_owner_status_idx` ON `animal_groups` (`owner_id`,`status`);--> statement-breakpoint
CREATE INDEX `animal_groups_owner_housing_idx` ON `animal_groups` (`owner_id`,`housing_field_id`);--> statement-breakpoint
CREATE TABLE `animal_locations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`field_id` text NOT NULL,
	`from_ms` integer NOT NULL,
	`to_ms` integer,
	`moved_by` text,
	`client_record_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`field_id`) REFERENCES `fields`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`moved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `animal_locations_owner_subject_from_idx` ON `animal_locations` (`owner_id`,`subject_type`,`subject_id`,`from_ms`);--> statement-breakpoint
CREATE INDEX `animal_locations_owner_field_from_idx` ON `animal_locations` (`owner_id`,`field_id`,`from_ms`);--> statement-breakpoint
CREATE TABLE `animals` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`group_id` text,
	`species_id` text NOT NULL,
	`breed` text,
	`name` text,
	`tag` text,
	`sex` text DEFAULT 'unknown' NOT NULL,
	`birth_date` integer,
	`birth_date_estimated` integer DEFAULT false NOT NULL,
	`acquired_date` integer,
	`acquired_from` text,
	`purpose` text DEFAULT 'production' NOT NULL,
	`food_producing` integer DEFAULT true NOT NULL,
	`not_for_slaughter` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`status_date` integer,
	`status_reason` text,
	`housing_field_id` text,
	`photo_ref` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `animal_groups`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`housing_field_id`) REFERENCES `fields`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `animals_owner_status_idx` ON `animals` (`owner_id`,`status`);--> statement-breakpoint
CREATE INDEX `animals_owner_group_idx` ON `animals` (`owner_id`,`group_id`);--> statement-breakpoint
CREATE INDEX `animals_owner_housing_idx` ON `animals` (`owner_id`,`housing_field_id`);