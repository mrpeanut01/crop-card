/**
 * Server-side SQLite handle. WAL mode + Litestream-friendly settings.
 *
 * The file path comes from DATABASE_URL ("file:/data/cropcard.db" in dev/prod).
 * Litestream replicates the WAL frames continuously to Azure Blob.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

const dbPath = (process.env.DATABASE_URL ?? 'file:/data/cropcard.db').replace(/^file:/, '');

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('synchronous = NORMAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');

export const db = drizzle(sqlite, { schema });
