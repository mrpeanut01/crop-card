-- FR-09 delete-lock enforcement (#308) + force-delete tombstones (#329).
--
-- `harvest_events` gains the same nullable `locked_at` column that
-- `spray_events` + `insecticide_events` already carry, so the 48-hour
-- immutability lock can be stamped + enforced on harvest deletes.
--
-- `record_deletions` is the #329 tombstone table: on an owner `?force=true`
-- hard-delete of a *locked* record (spray / insecticide / harvest), a row
-- is written here BEFORE the delete so the destroyed record leaves an
-- audit trace (kind, id, acting user, reason, JSON snapshot). Tenant-scoped
-- per CLAUDE.md invariant 6.
--
-- Note: this migration was hand-trimmed to the two intended changes. The
-- raw `drizzle-kit generate` diff ran against a stale committed snapshot
-- (meta/0030) and re-emitted already-applied 0031-0039 changes; only the
-- delta below is correct to apply. The committed 0040 snapshot reflects the
-- full current schema so future diffs remain clean.

ALTER TABLE `harvest_events` ADD `locked_at` integer;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `record_deletions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`record_kind` text NOT NULL,
	`record_id` text NOT NULL,
	`deleted_by` text,
	`reason` text,
	`deleted_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`snapshot_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `record_deletions_owner_deleted_idx` ON `record_deletions` (`owner_id`,`deleted_at`);
