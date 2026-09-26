ALTER TABLE `owner_subscriptions` ADD `billing_interval` text;--> statement-breakpoint
ALTER TABLE `owner_subscriptions` ADD `past_due_since` integer;--> statement-breakpoint
ALTER TABLE `owners` ADD `plan_override` text;--> statement-breakpoint
ALTER TABLE `owners` ADD `starter_boost_used_at` integer;--> statement-breakpoint
UPDATE `owner_subscriptions` SET `plan_code` = 'free' WHERE `plan_code` NOT IN ('free', 'grower', 'farm');--> statement-breakpoint
UPDATE `owner_subscriptions` SET `past_due_since` = `updated_at` WHERE `status` = 'past_due' AND `past_due_since` IS NULL;