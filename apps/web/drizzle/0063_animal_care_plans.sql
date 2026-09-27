CREATE TABLE `animal_care_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`product_plugin_id` text,
	`interval_days` integer,
	`once_on` integer,
	`next_due_at` integer,
	`lead_days` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`provenance` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `animal_care_plans_owner_active_due_idx` ON `animal_care_plans` (`owner_id`,`active`,`next_due_at`);--> statement-breakpoint
CREATE INDEX `animal_care_plans_owner_subject_idx` ON `animal_care_plans` (`owner_id`,`subject_type`,`subject_id`);