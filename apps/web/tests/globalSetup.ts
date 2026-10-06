/**
 * Vitest global setup — runs once before the test suite starts.
 *
 * Migrates one template SQLite database under a per-run temp directory.
 * `tests/vitestSetup.ts` then clones it for every test file, so no two
 * files share a database: one file's rows, deletes or write locks can never
 * reach another file, whatever order or load the files run under. The run
 * directory is unique per run so parallel runs (worktrees, CI shards) never
 * share it, and it is removed at teardown.
 */

import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const RUN_DIR = mkdtempSync(join(tmpdir(), `cropcard-test-${process.pid}-`));
const TEMPLATE_DB = join(RUN_DIR, 'template.db');

export function setup() {
  process.env.CROPCARD_TEST_DB_DIR = RUN_DIR;
  process.env.CROPCARD_TEST_DB_TEMPLATE = TEMPLATE_DB;
  process.env.DATABASE_URL = `file:${TEMPLATE_DB}`;
  // The free-pool brake sums spend across every farm in the database, so
  // tests that exercise it set the env var themselves.
  process.env.AI_FREE_POOL_MONTHLY_USD ??= '0';

  const appRoot = resolve(import.meta.dirname, '../');
  execSync('node ./scripts/migrate.mjs', {
    cwd: appRoot,
    env: { ...process.env, DATABASE_URL: `file:${TEMPLATE_DB}` },
    stdio: 'pipe'
  });
}

export function teardown() {
  rmSync(RUN_DIR, { recursive: true, force: true });
}
