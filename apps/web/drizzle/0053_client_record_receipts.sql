CREATE TABLE `client_record_receipts` (
	`owner_id` text NOT NULL,
	`client_record_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `client_record_id`)
);
