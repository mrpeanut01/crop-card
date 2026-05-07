CREATE TABLE `stock_items` (
	`id` text PRIMARY KEY NOT NULL,
	`plugin_id` text,
	`category` text NOT NULL,
	`display_name` text NOT NULL,
	`default_unit` text NOT NULL,
	`reorder_threshold_hundredths` integer,
	`notes` text
);
--> statement-breakpoint
CREATE TABLE `stock_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`stock_item_id` text NOT NULL,
	`lot_number` text,
	`expires_at` integer,
	`received_at` integer NOT NULL,
	`received_quantity_hundredths` integer NOT NULL,
	`received_cost_cents` integer,
	`supplier` text,
	`notes` text,
	FOREIGN KEY (`stock_item_id`) REFERENCES `stock_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`stock_lot_id` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`delta_hundredths` integer NOT NULL,
	`reason` text NOT NULL,
	`spray_event_id` text,
	`performed_by_id` text,
	`notes` text,
	FOREIGN KEY (`stock_lot_id`) REFERENCES `stock_lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`spray_event_id`) REFERENCES `spray_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`performed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
