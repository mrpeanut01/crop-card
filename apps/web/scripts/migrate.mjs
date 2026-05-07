/**
 * Production migration runner. Applied by the runtime entrypoint after
 * Litestream restore and before the Node server starts.
 *
 * Uses drizzle-orm's runtime migrator API so we don't need to ship the
 * drizzle-kit CLI (a devDependency) in the runtime image.
 */

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

sqlite.close();
