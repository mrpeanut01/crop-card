/**
 * Server-side sprayer access. Re-exports the DB-backed repo so existing
 * call sites (`$lib/server/sprayers`) keep working unchanged after the
 * Phase 3 → Phase 4 in-memory → SQLite migration.
 */

export {
  listSprayers,
  getSprayer,
  recordSpray,
  recordDecon,
  recordCalibration,
  type Sprayer
} from '$lib/db/sprayers';
