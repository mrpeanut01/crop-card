CREATE TABLE `equipment` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`label` text NOT NULL,
	`spec_json` text,
	`notes` text,
	`retired_at` integer
);
--> statement-breakpoint
CREATE TABLE `equipment_log` (
	`id` text PRIMARY KEY NOT NULL,
	`equipment_id` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`kind` text NOT NULL,
	`performed_by_id` text,
	`notes` text,
	`payload_json` text,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`performed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `equipment_state` (
	`equipment_id` text PRIMARY KEY NOT NULL,
	`hour_meter` integer,
	`last_chemistry_class` text,
	`last_used_at` integer,
	`last_decon_at` integer,
	`calibrated_gpa` integer,
	`calibration_date` integer,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE no action
);
