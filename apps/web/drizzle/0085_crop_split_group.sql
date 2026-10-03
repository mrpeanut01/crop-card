ALTER TABLE `crops` ADD `split_group_id` text;--> statement-breakpoint
CREATE INDEX `crops_owner_split_group_idx` ON `crops` (`owner_id`,`split_group_id`);