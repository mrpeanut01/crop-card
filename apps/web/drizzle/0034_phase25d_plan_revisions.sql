-- Phase 25d (#89) — plan_revisions table.
--
-- Per the v2 addendum + #89: every plan-commit / wizard-commit /
-- manual edit writes a revision row so the ProvenancePanel can show
-- where the current plan came from + audit the chain.
--
-- One row per write; parent_revision_id chains them. `source` tags the
-- write context (wizard / manual / ai-refinement). `payload_json` is
-- the full plan snapshot at commit time — coarse but accurate.
--
-- Tenant-scoped per CLAUDE.md invariant 6. The cross-tenant property
-- test gets extended in a follow-up commit.

CREATE TABLE IF NOT EXISTS `plan_revisions` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `owner_id` TEXT NOT NULL,
  `plan_id` TEXT NOT NULL,
  `revision_number` INTEGER NOT NULL,
  `source` TEXT NOT NULL,
  `payload_json` TEXT NOT NULL,
  `parent_revision_id` TEXT REFERENCES `plan_revisions`(`id`),
  `created_by_user_id` TEXT REFERENCES `users`(`id`),
  `created_at` INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `plan_revisions_owner_plan_idx`
  ON `plan_revisions` (`owner_id`, `plan_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `plan_revisions_owner_created_idx`
  ON `plan_revisions` (`owner_id`, `created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `plan_revisions_owner_plan_revno_uq`
  ON `plan_revisions` (`owner_id`, `plan_id`, `revision_number`);
