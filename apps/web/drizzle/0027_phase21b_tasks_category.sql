ALTER TABLE `tasks` ADD `category` text;--> statement-breakpoint
CREATE INDEX `tasks_category_idx` ON `tasks` (`category`);
