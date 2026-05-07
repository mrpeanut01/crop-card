/**
 * Server-side SQLite handle. WAL mode + Litestream-friendly settings.
 *
 * The file path comes from DATABASE_URL ("file:/data/cropcard.db" in dev/prod).
 * Litestream replicates the WAL frames continuously to Azure Blob.
 *
 * Lazy-init: SvelteKit's production build runs a route-analysis pass that
 * imports every server module. If we open the DB at import time, the build
 * crashes when /data doesn't exist (e.g., inside the docker build container).
 * The first call to a `db.…` method opens the connection on demand.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function open() {
  const dbPath = (process.env.DATABASE_URL ?? 'file:/data/cropcard.db').replace(/^file:/, '');
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  return drizzle(sqlite, { schema });
}

/** Proxy that opens the underlying drizzle handle on first method access. */
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    if (!_db) _db = open();
    return Reflect.get(_db, prop);
  }
});
