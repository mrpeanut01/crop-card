CREATE TABLE `amendment_batch_inputs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`input_type` text NOT NULL,
	`input_id` text NOT NULL,
	`from_at` integer NOT NULL,
	`to_at` integer,
	`supplier_statement` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `amendment_batches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `amendment_batch_inputs_owner_batch_input_uq` ON `amendment_batch_inputs` (`owner_id`,`batch_id`,`input_type`,`input_id`,`from_at`);--> statement-breakpoint
CREATE INDEX `amendment_batch_inputs_owner_input_idx` ON `amendment_batch_inputs` (`owner_id`,`input_type`,`input_id`);--> statement-breakpoint
CREATE TABLE `amendment_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`origin` text NOT NULL,
	`supplier` text,
	`supplier_statement` text,
	`started_at` integer NOT NULL,
	`closed_at` integer,
	`notes` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `amendment_batches_owner_started_idx` ON `amendment_batches` (`owner_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `amendment_bioassays` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`batch_id` text,
	`block_id` text,
	`tested_at` integer NOT NULL,
	`result` text NOT NULL,
	`note` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `amendment_batches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `amendment_bioassays_owner_block_idx` ON `amendment_bioassays` (`owner_id`,`block_id`);--> statement-breakpoint
CREATE INDEX `amendment_bioassays_owner_batch_idx` ON `amendment_bioassays` (`owner_id`,`batch_id`);--> statement-breakpoint
CREATE TABLE `amendment_dismissals` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`fertility_application_id` text NOT NULL,
	`block_id` text NOT NULL,
	`reason` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`fertility_application_id`) REFERENCES `fertility_applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `amendment_dismissals_owner_block_idx` ON `amendment_dismissals` (`owner_id`,`block_id`);--> statement-breakpoint
CREATE TABLE `forage_tests` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`block_id` text,
	`hay_cutting_id` text,
	`stock_lot_id` text,
	`sampled_at` integer NOT NULL,
	`lab` text,
	`nitrate_value_hundredths` integer,
	`nitrate_units` text,
	`hcn_ppm_hundredths` integer,
	`lab_rating_json` text,
	`document_id` text,
	`provenance` text DEFAULT 'manual' NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`hay_cutting_id`) REFERENCES `hay_cuttings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`stock_lot_id`) REFERENCES `stock_lots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `forage_tests_owner_block_idx` ON `forage_tests` (`owner_id`,`block_id`);--> statement-breakpoint
CREATE INDEX `forage_tests_owner_sampled_idx` ON `forage_tests` (`owner_id`,`sampled_at`);--> statement-breakpoint
ALTER TABLE `fertility_applications` ADD `amendment_batch_id` text;--> statement-breakpoint
ALTER TABLE `fertility_applications` ADD `carryover_ack_json` text;--> statement-breakpoint
ALTER TABLE `stock_lots` ADD `source_hay_cutting_id` text;