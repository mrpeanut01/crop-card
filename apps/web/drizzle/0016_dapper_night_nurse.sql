ALTER TABLE `crops` ADD `group_id` text;--> statement-breakpoint
ALTER TABLE `crops` ADD `group_role` text;--> statement-breakpoint
ALTER TABLE `crops` ADD `group_offset_days` integer;--> statement-breakpoint
ALTER TABLE `crops` ADD `group_system_kind` text;--> statement-breakpoint
CREATE INDEX `crops_block_group_idx` ON `crops` (`block_id`, `group_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `crops_group_anchor_unique` ON `crops` (`group_id`) WHERE `group_role` = 'anchor';