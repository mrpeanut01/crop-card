/**
 * Marketplace SQLite handle. Lazy singleton — the underlying
 * `Database` connection isn't opened until the first call to `getDb()`,
 * which keeps SvelteKit's post-build route analyzer from tripping on a
 * missing DB file at build time.
 *
 * Single-writer SQLite (CLAUDE.md invariant 3): there is at most one
 * `Database` instance per process. Both reads and writes go through it.
 */

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export { schema };
export type Db = BetterSQLite3Database<typeof schema>;

let _db: Db | undefined;
let _sqlite: Database.Database | undefined;

export function getDb(): Db {
  if (_db) return _db;
  const dbPath = (process.env.DATABASE_URL ?? 'file:/data/marketplace.db').replace(/^file:/, '');
  _sqlite = new Database(dbPath);
  _sqlite.pragma('journal_mode = WAL');
  _sqlite.pragma('foreign_keys = ON');
  _db = drizzle(_sqlite, { schema });
  return _db;
}

/** For tests / shutdown hooks. Production runs as a singleton for the
 *  process lifetime, so most callers never need this. */
export function closeDb(): void {
  _sqlite?.close();
  _sqlite = undefined;
  _db = undefined;
}
