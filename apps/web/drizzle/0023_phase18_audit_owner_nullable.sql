-- Phase 18 — superadmin_audit.owner_id should stay NULLABLE.
--
-- Migration 0022 inadvertently flipped this column to NOT NULL alongside the
-- tenant-scoped tables. Cross-tenant actions (grant_superadmin,
-- exit_impersonation, etc.) legitimately have no owner_id, so we rebuild the
-- table once more with the column nullable. Idempotent: re-running it after
-- the correction is a no-op because the schema already matches.

PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_superadmin_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`superadmin_user_id` text NOT NULL,
	`action` text NOT NULL,
	`owner_id` text,
	`target_table` text,
	`target_id` text,
	`payload_json` text,
	`at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`superadmin_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_superadmin_audit`("id", "superadmin_user_id", "action", "owner_id", "target_table", "target_id", "payload_json", "at")
SELECT "id", "superadmin_user_id", "action", "owner_id", "target_table", "target_id", "payload_json", "at" FROM `superadmin_audit`;--> statement-breakpoint
DROP TABLE `superadmin_audit`;--> statement-breakpoint
ALTER TABLE `__new_superadmin_audit` RENAME TO `superadmin_audit`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
