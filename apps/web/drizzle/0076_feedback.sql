CREATE TABLE `feedback_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`owner_id` text,
	`user_id` text,
	`role` text,
	`page_path` text,
	`app_version` text,
	`user_agent` text,
	`status` text DEFAULT 'new' NOT NULL,
	`admin_notes` text,
	`github_issue_url` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `feedback_submissions_status_created_idx` ON `feedback_submissions` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `feedback_submissions_user_idx` ON `feedback_submissions` (`user_id`);