CREATE TABLE `api_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`user_id` text NOT NULL,
	`label` text NOT NULL,
	`token_hash` text NOT NULL,
	`is_service_account` integer DEFAULT 0 NOT NULL,
	`daily_quota_allocate` integer,
	`daily_quota_schedule` integer,
	`daily_quota_inputs` integer,
	`daily_quota_stock_refresh` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_used_at` integer,
	`request_count` integer DEFAULT 0 NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `owners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_token_hash_idx` ON `api_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `api_tokens_owner_idx` ON `api_tokens` (`owner_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `ai_call_log` ADD `token_id` text REFERENCES api_tokens(id);
