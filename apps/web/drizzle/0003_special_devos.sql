CREATE TABLE `pending_calibrations` (
	`id` text PRIMARY KEY NOT NULL,
	`equipment_id` text NOT NULL,
	`submitted_by_id` text NOT NULL,
	`submitted_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`calibrated_gpa` integer NOT NULL,
	`spread_inches` integer,
	`ounces_collected` integer,
	`notes` text,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submitted_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
