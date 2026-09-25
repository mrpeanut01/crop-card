CREATE TABLE `login_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`channel` text NOT NULL,
	`purpose` text NOT NULL,
	`destination` text NOT NULL,
	`user_id` text,
	`login_token_id` text,
	`code_hash` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`ip_hash` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `login_codes_destination_idx` ON `login_codes` (`destination`,`created_at`);--> statement-breakpoint
CREATE INDEX `login_codes_ip_idx` ON `login_codes` (`ip_hash`,`created_at`);--> statement-breakpoint
CREATE INDEX `login_codes_login_token_idx` ON `login_codes` (`login_token_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`phone` text,
	`is_superadmin` integer DEFAULT false NOT NULL,
	`ai_enabled` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "email", "phone", "is_superadmin", "ai_enabled", "created_at") SELECT "id", "email", NULL, "is_superadmin", "ai_enabled", "created_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_phone_unique` ON `users` (`phone`);