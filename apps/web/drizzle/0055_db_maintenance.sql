CREATE TABLE `system_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_call_log_user_endpoint_created_idx` ON `ai_call_log` (`user_id`,`endpoint`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_call_log_token_endpoint_created_idx` ON `ai_call_log` (`token_id`,`endpoint`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_call_log_created_usd_idx` ON `ai_call_log` (`created_at`,`usd_estimate`);