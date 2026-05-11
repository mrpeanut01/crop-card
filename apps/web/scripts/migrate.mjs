/**
 * Production migration runner. Applied by the runtime entrypoint after
 * Litestream restore and before the Node server starts.
 *
 * Uses drizzle-orm's runtime migrator API so we don't need to ship the
 * drizzle-kit CLI (a devDependency) in the runtime image.
 *
 * Phase 13 also runs a post-migration backfill so the new Field hierarchy
 * is populated for existing data:
 *   - auto-create a "Home Field" row and point every block at it
 *   - backfill stock_movements.crop_id from the source event row
 */

import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

const dbPath = (process.env.DATABASE_URL ?? 'file:/data/cropcard.db').replace(/^file:/, '');
const migrationsFolder = process.env.MIGRATIONS_FOLDER ?? './drizzle';

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

const db = drizzle(sqlite);

console.log(`[migrate] applying migrations from ${migrationsFolder} to ${dbPath}`);
migrate(db, { migrationsFolder });
console.log('[migrate] done');

backfillPhase13(sqlite);

sqlite.close();

/**
 * Phase 13 backfill — idempotent. Safe to run on every boot:
 * 1. Ensure every block has a field_id; create a "Home Field" if none exists.
 * 2. Backfill stock_movements.crop_id from the source event row's crop_id.
 */
function backfillPhase13(db) {
  // Skip if the new columns / tables don't exist yet (older snapshot or
  // partial migrate).
  const hasFields = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='fields'`)
    .get();
  if (!hasFields) return;

  const orphanCount = db
    .prepare(`SELECT COUNT(*) AS n FROM blocks WHERE field_id IS NULL`)
    .get().n;
  if (orphanCount > 0) {
    let homeField = db
      .prepare(`SELECT id FROM fields WHERE name = 'Home Field' ORDER BY created_at LIMIT 1`)
      .get();
    if (!homeField) {
      const id = randomUUID();
      db.prepare(
        `INSERT INTO fields (id, name, notes) VALUES (?, 'Home Field', 'Auto-created during migration so existing blocks have a parent. Rename or split as needed.')`
      ).run(id);
      homeField = { id };
      console.log(`[migrate] created Home Field ${id}`);
    }
    const r = db
      .prepare(`UPDATE blocks SET field_id = ? WHERE field_id IS NULL`)
      .run(homeField.id);
    console.log(`[migrate] migrated ${r.changes} block(s) to Home Field`);
  }

  const hasMovementCropId = db
    .prepare(`PRAGMA table_info(stock_movements)`)
    .all()
    .some((c) => c.name === 'crop_id');
  if (hasMovementCropId) {
    const sprayBackfill = db
      .prepare(
        `UPDATE stock_movements
         SET crop_id = (SELECT spray_events.crop_id FROM spray_events WHERE spray_events.id = stock_movements.spray_event_id)
         WHERE stock_movements.crop_id IS NULL
           AND stock_movements.spray_event_id IS NOT NULL`
      )
      .run();
    const insecBackfill = db
      .prepare(
        `UPDATE stock_movements
         SET crop_id = (SELECT insecticide_events.crop_id FROM insecticide_events WHERE insecticide_events.id = stock_movements.insecticide_event_id)
         WHERE stock_movements.crop_id IS NULL
           AND stock_movements.insecticide_event_id IS NOT NULL`
      )
      .run();
    const fertBackfill = db
      .prepare(
        `UPDATE stock_movements
         SET crop_id = (SELECT fertility_applications.crop_id FROM fertility_applications WHERE fertility_applications.id = stock_movements.fertility_application_id)
         WHERE stock_movements.crop_id IS NULL
           AND stock_movements.fertility_application_id IS NOT NULL`
      )
      .run();
    const total = sprayBackfill.changes + insecBackfill.changes + fertBackfill.changes;
    if (total > 0) {
      console.log(
        `[migrate] backfilled stock_movements.crop_id: spray=${sprayBackfill.changes} insec=${insecBackfill.changes} fert=${fertBackfill.changes}`
      );
    }
  }
}
