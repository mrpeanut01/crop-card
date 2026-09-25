CREATE TABLE `login_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`email` text NOT NULL,
	`ip_hash` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `login_tokens_token_hash_idx` ON `login_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `login_tokens_email_idx` ON `login_tokens` (`email`,`created_at`);--> statement-breakpoint
CREATE INDEX `login_tokens_ip_idx` ON `login_tokens` (`ip_hash`,`created_at`);