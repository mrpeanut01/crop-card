DROP INDEX `contact_suppressions_address_channel_reason_uq`;--> statement-breakpoint
CREATE UNIQUE INDEX `contact_suppressions_address_channel_reason_type_uq` ON `contact_suppressions` (`address`,`channel`,`reason`,coalesce(`notification_type`, ''));
