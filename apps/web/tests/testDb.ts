/**
 * Per-test-file SQLite databases, cloned from the template that
 * `tests/globalSetup.ts` migrated once for the run.
 */

import { randomUUID } from 'node:crypto';
import { constants, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** Clones the migrated template to a new file and returns its path. */
export function cloneTemplateDb(label = 'file'): string {
  const template = process.env.CROPCARD_TEST_DB_TEMPLATE;
  const dir = process.env.CROPCARD_TEST_DB_DIR;
  if (!template || !dir) throw new Error('tests/globalSetup.ts did not run');
  const path = join(dir, `${label}-${process.pid}-${randomUUID()}.db`);
  // A copy-on-write clone where the filesystem supports it, a plain copy
  // otherwise. The template is closed and checkpointed, so the main file
  // alone holds the whole schema.
  copyFileSync(template, path, constants.COPYFILE_FICLONE);
  return path;
}

export function removeDb(path: string): void {
  for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
}
