/**
 * Vitest global setup — runs once before the test suite starts.
 *
 * Creates a fresh SQLite database under the OS temp dir and runs all
 * Drizzle migrations against it so integration tests get a clean schema
 * without touching the developer's live /data/cropcard.db. The path is
 * unique per run so parallel runs (worktrees, CI shards) never share it.
 */

import { execSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const TEST_DB = join(tmpdir(), `cropcard-test-${process.pid}-${Date.now()}.db`);

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
    try {
      unlinkSync(p);
    } catch {
      /* already gone */
    }
  }
}
