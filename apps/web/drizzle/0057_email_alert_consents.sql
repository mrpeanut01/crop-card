CREATE TABLE `contact_suppressions` (
	`id` text PRIMARY KEY NOT NULL,
	`address` text NOT NULL,
	`channel` text NOT NULL,
	`reason` text NOT NULL,
	`source` text NOT NULL,
	`event_id` text,
	`notification_type` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contact_suppressions_address_channel_reason_uq` ON `contact_suppressions` (`address`,`channel`,`reason`);--> statement-breakpoint
CREATE TABLE `email_alert_consents` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`user_id` text NOT NULL,
	`category` text NOT NULL,
	`status` text NOT NULL,
	`opted_in_at` integer,
	`opted_in_source` text,
	`opted_in_ip` text,
	`opted_out_at` integer,
	`opted_out_source` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_alert_consents_owner_user_category_uq` ON `email_alert_consents` (`owner_id`,`user_id`,`category`);--> statement-breakpoint
CREATE INDEX `email_alert_consents_owner_status_idx` ON `email_alert_consents` (`owner_id`,`status`);