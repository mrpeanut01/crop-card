/**
 * Vitest global setup — runs once before the test suite starts.
 *
 * Creates a fresh SQLite database at /tmp/cropcard-test.db and runs all
 * Drizzle migrations against it so integration tests get a clean schema
 * without touching the developer's live /data/cropcard.db.
 */

import { execSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const TEST_DB = '/tmp/cropcard-test.db';

export function setup() {
  // Wipe any leftover from a previous run so tests always start clean.
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (existsSync(p)) unlinkSync(p);
  }

  process.env.DATABASE_URL = `file:${TEST_DB}`;

  const appRoot = resolve(import.meta.dirname, '../');
  execSync('node ./scripts/migrate.mjs', {
    cwd: appRoot,
    env: { ...process.env, DATABASE_URL: `file:${TEST_DB}` },
    stdio: 'pipe'
  });
}

export function teardown() {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    try { unlinkSync(p); } catch { /* already gone */ }
  }
}
