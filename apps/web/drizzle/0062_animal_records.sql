CREATE TABLE `animal_flag_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`flag` text NOT NULL,
	`old_value` integer,
	`new_value` integer NOT NULL,
	`reason` text NOT NULL,
	`changed_by` text,
	`changed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`changed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `animal_flag_changes_owner_subject_changed_idx` ON `animal_flag_changes` (`owner_id`,`subject_type`,`subject_id`,`changed_at`);--> statement-breakpoint
CREATE TABLE `animal_health_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`kind` text NOT NULL,
	`product_plugin_id` text,
	`product_name` text,
	`stock_item_id` text,
	`lot_number` text,
	`dose` real,
	`dose_unit` text,
	`route` text,
	`administered_at` integer NOT NULL,
	`course_end_at` integer,
	`label_use` text,
	`vet_name` text,
	`vet_directed_withdrawal` text,
	`withdrawal_clear` text,
	`rules_version` text,
	`food_producing_at_record` integer NOT NULL,
	`notes` text,
	`performed_by_id` text,
	`client_record_id` text,
	`locked_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`stock_item_id`) REFERENCES `stock_items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`performed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `animal_health_events_owner_subject_admin_idx` ON `animal_health_events` (`owner_id`,`subject_type`,`subject_id`,`administered_at`);--> statement-breakpoint
CREATE INDEX `animal_health_events_owner_admin_idx` ON `animal_health_events` (`owner_id`,`administered_at`);--> statement-breakpoint
CREATE TABLE `animal_production_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`kind` text NOT NULL,
	`quantity` real NOT NULL,
	`unit` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`use` text NOT NULL,
	`rules_version` text,
	`performed_by_id` text,
	`client_record_id` text,
	`locked_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`performed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `animal_production_logs_owner_subject_occurred_idx` ON `animal_production_logs` (`owner_id`,`subject_type`,`subject_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `animal_status_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`status` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`reason` text,
	`head_count_delta` integer,
	`rules_version` text,
	`recorded_by_id` text,
	`client_record_id` text,
	`locked_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`recorded_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `animal_status_events_owner_subject_occurred_idx` ON `animal_status_events` (`owner_id`,`subject_type`,`subject_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `grazing_attestations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`field_id` text NOT NULL,
	`product_plugin_id` text,
	`spray_event_ref` text,
	`graze_days` integer,
	`hay_days` integer,
	`reason` text NOT NULL,
	`provenance` text DEFAULT 'manual' NOT NULL,
	`attested_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`field_id`) REFERENCES `fields`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `grazing_attestations_owner_field_idx` ON `grazing_attestations` (`owner_id`,`field_id`,`created_at`);