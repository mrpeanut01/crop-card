CREATE TABLE `blob_deletions` (
	`storage_prefix` text PRIMARY KEY NOT NULL,
	`requested_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text
);
--> statement-breakpoint
CREATE TABLE `document_links` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`document_id` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_links_owner_doc_subject_uq` ON `document_links` (`owner_id`,`document_id`,`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `document_links_owner_subject_idx` ON `document_links` (`owner_id`,`subject_type`,`subject_id`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`mime` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`crc32` integer NOT NULL,
	`storage_key` text NOT NULL,
	`original_name` text,
	`uploaded_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`deleted_by` text,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `documents_owner_kind_created_idx` ON `documents` (`owner_id`,`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `documents_owner_deleted_idx` ON `documents` (`owner_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `documents_storage_key_uq` ON `documents` (`storage_key`);--> statement-breakpoint
ALTER TABLE `animals` ADD `photo_document_id` text;--> statement-breakpoint
ALTER TABLE `planting_journal` ADD `photo_document_id` text;