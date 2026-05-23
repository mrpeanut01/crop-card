CREATE TABLE `admin_login_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`admin_user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	`redeemed_at` integer,
	FOREIGN KEY (`admin_user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_login_tokens_hash_idx` ON `admin_login_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `admin_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`last_login_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_users_email_idx` ON `admin_users` (`email`);--> statement-breakpoint
CREATE TABLE `app_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`trust_level` text DEFAULT 'community' NOT NULL,
	`credential_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_used_at` integer,
	`request_count` integer DEFAULT 0 NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_credentials_hash_idx` ON `app_credentials` (`credential_hash`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`target_table` text,
	`target_id` text,
	`payload` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_actor_idx` ON `audit_log` (`actor_type`,`actor_id`);--> statement-breakpoint
CREATE INDEX `audit_log_created_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `plugin_listings` (
	`plugin_id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`display_name` text NOT NULL,
	`latest_approved_version` text,
	`latest_approved_hash` text,
	`source_credential_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`source_credential_id`) REFERENCES `app_credentials`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `plugin_listings_type_idx` ON `plugin_listings` (`type`);--> statement-breakpoint
CREATE INDEX `plugin_listings_updated_idx` ON `plugin_listings` (`updated_at`);--> statement-breakpoint
CREATE TABLE `plugin_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`plugin_id` text NOT NULL,
	`version` text NOT NULL,
	`hash` text NOT NULL,
	`payload` text NOT NULL,
	`uploaded_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`uploaded_by_credential_id` text NOT NULL,
	`review_status` text DEFAULT 'pending_review' NOT NULL,
	`reviewed_by_admin_id` text,
	`reviewed_at` integer,
	`review_notes` text,
	`scan_results` text,
	FOREIGN KEY (`uploaded_by_credential_id`) REFERENCES `app_credentials`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_by_admin_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `plugin_versions_plugin_id_idx` ON `plugin_versions` (`plugin_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `plugin_versions_plugin_hash_idx` ON `plugin_versions` (`plugin_id`,`hash`);--> statement-breakpoint
CREATE INDEX `plugin_versions_status_idx` ON `plugin_versions` (`review_status`);