-- Sprint 3 (#173 / CT-W-004) — wizard_drafts table for Save & resume later.
--
-- The wizard runs as a multi-step modal whose only exit gestures were
-- "Cancel" + "Exit" (both discard). Phase 25 design promises a third
-- gesture — "Save & resume later" — that snapshots the current step +
-- form values + chat messages and lets the user re-enter the wizard
-- where they left off.
--
-- Shape: one row per (owner, plan_id) — the wizard can only have one
-- in-flight draft per season plan at a time. Re-saving overwrites.
-- Resume reads the most recent row for the active plan, hydrates the
-- step + state, and deletes the row on commit/close.
--
-- payload_json is the serialized {step, selectedSeeds, selectedBlocks,
-- chatMessages}. Schema kept fluid via JSON to avoid migrating every
-- time the wizard's step state shape changes; validator lives in
-- `lib/wizard/drafts.ts`.
--
-- Tenant-scoped per CLAUDE.md invariant 6.

CREATE TABLE IF NOT EXISTS `wizard_drafts` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `owner_id` TEXT NOT NULL,
  `plan_id` TEXT NOT NULL,
  `step` TEXT NOT NULL,
  `payload_json` TEXT NOT NULL,
  `updated_at` INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  `created_by_user_id` TEXT REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `wizard_drafts_owner_plan_uq`
  ON `wizard_drafts` (`owner_id`, `plan_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `wizard_drafts_owner_updated_idx`
  ON `wizard_drafts` (`owner_id`, `updated_at`);
