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
import { instrumentSqlite } from './instrument';

type Db = ReturnType<typeof drizzle<typeof schema>>;

let _db: Db | null = null;
let _sqlite: Database.Database | null = null;

export function databasePath(): string {
  return (process.env.DATABASE_URL ?? 'file:/data/cropcard.db').replace(/^file:/, '');
}

/** Connection pragmas. WAL + NORMAL + the default autocheckpoint stay as
 *  Litestream expects (it reads WAL frames and runs its own checkpoints).
 *  Sized for a 1 GiB container: the page cache grows to 64 MiB only as
 *  pages are touched, and mmap pages are reclaimable file cache. */
export const CONNECTION_PRAGMAS = [
  'journal_mode = WAL',
  'synchronous = NORMAL',
  'foreign_keys = ON',
  'busy_timeout = 5000',
  'cache_size = -65536',
  'mmap_size = 268435456',
  'temp_store = MEMORY',
  'journal_size_limit = 67108864',
  // Bounds every ANALYZE that optimize runs: a stats-less 160 MB DB takes
  // ~35 ms at open instead of ~1.2 s.
  'analysis_limit = 1000'
] as const;

export function applyConnectionPragmas(sqlite: Database.Database): void {
  for (const p of CONNECTION_PRAGMAS) sqlite.pragma(p);
  // 0x10002: analyze tables whose stats are missing or stale.
  sqlite.pragma('optimize = 0x10002');
}

function open() {
  const sqlite = new Database(databasePath());
  applyConnectionPragmas(sqlite);
  instrumentSqlite(sqlite);
  _sqlite = sqlite;
  return drizzle(sqlite, { schema });
}

/** The underlying better-sqlite3 handle, for pragmas and maintenance. */
export function sqliteHandle(): Database.Database {
  if (!_db) _db = open();
  return _sqlite!;
}

/**
 * Transactions default to BEGIN IMMEDIATE. A deferred transaction that reads
 * before it writes gets SQLITE_BUSY_SNAPSHOT, with no busy-timeout wait, when
 * another connection (Litestream, or a parallel test worker) commits in
 * between. Taking the write lock up front makes it wait instead.
 */
const transaction: Db['transaction'] = (fn, config) =>
  _db!.transaction(fn, { behavior: 'immediate', ...config });

/** Proxy that opens the underlying drizzle handle on first method access. */
export const db = new Proxy({} as Db, {
  get(_target, prop) {
    if (!_db) _db = open();
    if (prop === 'transaction') return transaction;
    return Reflect.get(_db, prop);
  }
});

/** Deploy handoff fence: refuse every further write on this connection so
 *  nothing lands after the release record. Returns the page size, which
 *  Litestream's WAL position math needs. */
export function setDbReadOnly(): number {
  if (!_db) _db = open();
  const sqlite = _sqlite!;
  sqlite.pragma('query_only = ON');
  return Number(sqlite.pragma('page_size', { simple: true }));
}

/** Readiness probe: one round trip through the real connection. */
export function pingDb(): void {
  if (!_db) _db = open();
  _sqlite!.prepare('SELECT 1').get();
}
