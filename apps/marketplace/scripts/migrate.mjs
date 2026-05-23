/**
 * Marketplace migration runner. Applied by the runtime entrypoint after
 * Litestream restore and before the Node server starts.
 *
 * Mirrors apps/web/scripts/migrate.mjs but no Phase 13 backfill — the
 * marketplace starts empty (apart from a `seed-import` credential the
 * Sub-task G bulk import will provision).
 *
 * The FK-off pragma is here for symmetry with the main app's runner;
 * SQLite ignores `PRAGMA foreign_keys = OFF` inside a transaction and
 * drizzle wraps each migration file in one, so future migrations that
 * need to rewrite FK-referenced tables work the same way.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

const dbPath = (process.env.DATABASE_URL ?? 'file:/data/marketplace.db').replace(/^file:/, '');
const migrationsFolder = process.env.MIGRATIONS_FOLDER ?? './drizzle';

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = OFF');

const db = drizzle(sqlite);

console.log(`[marketplace migrate] applying migrations from ${migrationsFolder} to ${dbPath}`);
migrate(db, { migrationsFolder });
console.log('[marketplace migrate] done');

sqlite.pragma('foreign_keys = ON');
const fkViolations = sqlite.prepare('PRAGMA foreign_key_check').all();
if (fkViolations.length > 0) {
  console.error('[marketplace migrate] FK violations detected after migrate:', fkViolations);
  process.exit(1);
}

sqlite.close();
