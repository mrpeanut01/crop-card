/**
 * drizzle's migrator only applies a journal entry whose `when` is later
 * than the newest row in `__drizzle_migrations`. Two branches that each add
 * migrations can merge in either order, so the one that deploys second may
 * carry entries stamped before what production already ran, and drizzle
 * would skip them without a word. This applies those entries first, in
 * journal order, so the migrator never silently drops one.
 *
 * An entry counts as applied when its SQL hash or its `when` is already in
 * the table, so an old file that was reformatted after it ran is not
 * replayed. Anything that still fails to apply stops the boot.
 */

import { readMigrationFiles } from 'drizzle-orm/migrator';

/**
 * @param {import('better-sqlite3').Database} sqlite
 * @param {string} migrationsFolder
 * @param {(msg: string) => void} [log]
 * @returns {number[]} the `when` of each migration applied here
 */
export function applyOutOfOrderMigrations(sqlite, migrationsFolder, log = console.log) {
  const hasTable = sqlite
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'`)
    .get();
  if (!hasTable) return [];
  const rows = /** @type {Array<{ hash: string; created_at: number | string }>} */ (
    sqlite.prepare(`SELECT hash, created_at FROM __drizzle_migrations`).all()
  );
  if (rows.length === 0) return [];
  const hashes = new Set(rows.map((r) => r.hash));
  const stamps = new Set(rows.map((r) => Number(r.created_at)));
  const last = Math.max(...stamps);
  const pending = readMigrationFiles({ migrationsFolder }).filter(
    (m) => m.folderMillis < last && !hashes.has(m.hash) && !stamps.has(m.folderMillis)
  );
  if (pending.length === 0) return [];
  const insert = sqlite.prepare(
    `INSERT INTO __drizzle_migrations ("hash", "created_at") VALUES (?, ?)`
  );
  const run = sqlite.transaction(() => {
    for (const m of pending) {
      for (const stmt of m.sql) {
        if (stmt.trim() !== '') sqlite.exec(stmt);
      }
      insert.run(m.hash, m.folderMillis);
    }
  });
  run();
  log(
    `[migrate] applied ${pending.length} migration(s) stamped before the last applied one: ${pending
      .map((m) => m.folderMillis)
      .join(', ')}`
  );
  return pending.map((m) => m.folderMillis);
}
