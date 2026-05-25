-- Phase 25d (#89) — wizard chat server-persistence.
--
-- Two tables: wizard_sessions + wizard_chat_messages. Replaces the
-- in-memory $state arrays in AllocationWizard.svelte so chat history
-- survives reload + is auditable via the ProvenancePanel chain later.
--
-- Tenant-scoped per CLAUDE.md invariant 6; cross-tenant property test
-- gets extended in the same commit that ships this migration.

CREATE TABLE IF NOT EXISTS `wizard_sessions` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `owner_id` TEXT NOT NULL,
  `plan_id` TEXT NOT NULL,
  `status` TEXT NOT NULL,
  `created_by_user_id` TEXT REFERENCES `users`(`id`),
  `created_at` INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  `last_active_at` INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  `completed_at` INTEGER
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `wizard_sessions_owner_plan_idx`
  ON `wizard_sessions` (`owner_id`, `plan_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `wizard_sessions_owner_status_idx`
  ON `wizard_sessions` (`owner_id`, `status`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `wizard_chat_messages` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `owner_id` TEXT NOT NULL,
  `session_id` TEXT NOT NULL REFERENCES `wizard_sessions`(`id`) ON DELETE CASCADE,
  `step` TEXT NOT NULL,
  `role` TEXT NOT NULL,
  `content` TEXT NOT NULL,
  `created_at` INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `wizard_chat_messages_owner_session_step_idx`
  ON `wizard_chat_messages` (`owner_id`, `session_id`, `step`, `created_at`);
