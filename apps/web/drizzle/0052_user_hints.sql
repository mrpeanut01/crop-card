CREATE TABLE `user_hints` (
	`user_id` text NOT NULL,
	`hint_key` text NOT NULL,
	`seen_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `hint_key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
