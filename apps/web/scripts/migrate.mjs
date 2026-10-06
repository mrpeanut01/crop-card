/**
 * Production migration runner (`pnpm db:migrate`, infra/entrypoint.sh).
 * Reads DATABASE_URL, MIGRATIONS_FOLDER and PLUGINS_DIR, runs the steps in
 * `migrateRunner.mjs` and exits non-zero on any failure, which stops the boot.
 */

import path from 'node:path';
import { runMigrations } from './migrateRunner.mjs';

try {
  runMigrations({
    dbPath: (process.env.DATABASE_URL ?? 'file:/data/cropcard.db').replace(/^file:/, ''),
    migrationsFolder: process.env.MIGRATIONS_FOLDER ?? './drizzle',
    pluginsRoot: process.env.PLUGINS_DIR ?? path.resolve(process.cwd(), '..', '..', 'plugins')
  });
} catch (e) {
  console.error(e);
  process.exit(1);
}
