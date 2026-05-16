ALTER TABLE `stock_items` ADD `pending_refresh_json` text;--> statement-breakpoint
ALTER TABLE `stock_items` ADD `pending_refresh_at` integer;
