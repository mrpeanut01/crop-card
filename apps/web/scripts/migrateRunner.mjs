/**
 * Production migration steps. Applied by the runtime entrypoint after
 * Litestream restore and before the Node server starts.
 *
 * Uses drizzle-orm's runtime migrator API so we don't need to ship the
 * drizzle-kit CLI (a devDependency) in the runtime image.
 *
 * Phase 13 also runs a post-migration backfill so the new Field hierarchy
 * is populated for existing data:
 *   - auto-create a "Home Field" row and point every block at it
 *   - backfill stock_movements.crop_id from the source event row
 *
 * `scripts/migrate.mjs` is the command-line entry; tests import
 * `runMigrations` from here so they run the same steps without starting a
 * Node process.
 */

import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { applyOutOfOrderMigrations } from './migrateOutOfOrder.mjs';

/**
 * @param {{ dbPath: string; migrationsFolder: string; pluginsRoot: string; log?: (msg: string) => void }} opts
 */
export function runMigrations({ dbPath, migrationsFolder, pluginsRoot, log = console.log }) {
  const sqlite = new Database(dbPath);
  try {
    sqlite.pragma('journal_mode = WAL');

    // Phase 18 multi-tenant migrations (0020+, NOT NULL enforcement) need to
    // drop tables that are FK-referenced by other tables during the SQLite
    // table-rebuild dance. SQLite ignores `PRAGMA foreign_keys = OFF` inside
    // an active transaction, and drizzle wraps each migration file in one
    // transaction — so we disable FK enforcement at the connection level
    // before migrate() and re-enable + verify after.
    sqlite.pragma('foreign_keys = OFF');

    const db = drizzle(sqlite);

    log(`[migrate] applying migrations from ${migrationsFolder} to ${dbPath}`);
    applyOutOfOrderMigrations(sqlite, migrationsFolder, log);
    migrate(db, { migrationsFolder });
    log('[migrate] done');

    sqlite.pragma('foreign_keys = ON');
    const fkViolations = sqlite.prepare('PRAGMA foreign_key_check').all();
    if (fkViolations.length > 0) {
      throw new Error(
        `[migrate] FK violations detected after migrate: ${JSON.stringify(fkViolations)}`
      );
    }

    backfillPhase13(sqlite, log);
    backfillPhase22PluginVersions(sqlite, pluginsRoot, log);
  } finally {
    sqlite.close();
  }
}

/**
 * Phase 13 backfill — idempotent. Safe to run on every boot:
 * 1. Ensure every block has a field_id; create a "Home Field" if none exists.
 * 2. Backfill stock_movements.crop_id from the source event row's crop_id.
 */
/**
 * @param {import('better-sqlite3').Database} db
 * @param {(msg: string) => void} log
 */
function backfillPhase13(db, log) {
  // Skip if the new columns / tables don't exist yet (older snapshot or
  // partial migrate).
  const hasFields = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='fields'`)
    .get();
  if (!hasFields) return;

  const orphanCount = /** @type {{ n: number }} */ (
    db.prepare(`SELECT COUNT(*) AS n FROM blocks WHERE field_id IS NULL`).get()
  ).n;
  if (orphanCount > 0) {
    let homeField = /** @type {{ id: string } | undefined} */ (
      db
        .prepare(`SELECT id FROM fields WHERE name = 'Home Field' ORDER BY created_at LIMIT 1`)
        .get()
    );
    if (!homeField) {
      const id = randomUUID();
      db.prepare(
        `INSERT INTO fields (id, name, notes) VALUES (?, 'Home Field', 'Auto-created during migration so existing blocks have a parent. Rename or split as needed.')`
      ).run(id);
      homeField = { id };
      log(`[migrate] created Home Field ${id}`);
    }
    const r = db.prepare(`UPDATE blocks SET field_id = ? WHERE field_id IS NULL`).run(homeField.id);
    log(`[migrate] migrated ${r.changes} block(s) to Home Field`);
  }

  const hasMovementCropId = db
    .prepare(`PRAGMA table_info(stock_movements)`)
    .all()
    .some((c) => /** @type {{ name: string }} */ (c).name === 'crop_id');
  if (hasMovementCropId) {
    const sprayBackfill = db
      .prepare(
        `UPDATE stock_movements
         SET crop_id = (SELECT spray_events.crop_id FROM spray_events WHERE spray_events.id = stock_movements.spray_event_id)
         WHERE stock_movements.crop_id IS NULL
           AND stock_movements.spray_event_id IS NOT NULL`
      )
      .run();
    const insecBackfill = db
      .prepare(
        `UPDATE stock_movements
         SET crop_id = (SELECT insecticide_events.crop_id FROM insecticide_events WHERE insecticide_events.id = stock_movements.insecticide_event_id)
         WHERE stock_movements.crop_id IS NULL
           AND stock_movements.insecticide_event_id IS NOT NULL`
      )
      .run();
    const fertBackfill = db
      .prepare(
        `UPDATE stock_movements
         SET crop_id = (SELECT fertility_applications.crop_id FROM fertility_applications WHERE fertility_applications.id = stock_movements.fertility_application_id)
         WHERE stock_movements.crop_id IS NULL
           AND stock_movements.fertility_application_id IS NOT NULL`
      )
      .run();
    const total = sprayBackfill.changes + insecBackfill.changes + fertBackfill.changes;
    if (total > 0) {
      log(
        `[migrate] backfilled stock_movements.crop_id: spray=${sprayBackfill.changes} insec=${insecBackfill.changes} fert=${fertBackfill.changes}`
      );
    }
  }
}

/**
 * Phase 22 backfill — seed one `plugin_versions` row per on-disk plugin
 * file. Idempotent: existing rows (same pluginId) are skipped. The hash is
 * computed identically to `pluginFiles.ts` (canonical JSON of the parsed
 * payload), so a subsequent `pluginHashesJson` lookup from an event row
 * matches the seeded row.
 */
/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} pluginsRoot
 * @param {(msg: string) => void} log
 */
function backfillPhase22PluginVersions(db, pluginsRoot, log) {
  const hasTable = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='plugin_versions'`)
    .get();
  if (!hasTable) return;

  if (!safeStat(pluginsRoot)?.isDirectory()) return;

  const subdirToKind = {
    crops: 'crop',
    herbicides: 'herbicide',
    insecticides: 'insecticide',
    fungicides: 'fungicide',
    fertilizers: 'fertilizer',
    companions: 'companion'
  };

  const exists = db.prepare(
    `SELECT 1 FROM plugin_versions WHERE plugin_id = ? AND superseded_at IS NULL`
  );
  const insertStmt = db.prepare(
    `INSERT INTO plugin_versions
       (id, plugin_id, version, kind, hash, payload_json, change_reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'initial-import', unixepoch() * 1000)`
  );

  let inserted = 0;
  for (const [subdir, kind] of Object.entries(subdirToKind)) {
    const dir = path.join(pluginsRoot, subdir);
    const stat = safeStat(dir);
    if (!stat?.isDirectory()) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      const file = path.join(dir, name);
      let parsed;
      try {
        parsed = JSON.parse(readFileSync(file, 'utf-8'));
      } catch (e) {
        console.warn(
          `[migrate] skipping unparseable ${file}: ${e instanceof Error ? e.message : String(e)}`
        );
        continue;
      }
      const pluginId = parsed.pluginId;
      if (!pluginId) continue;
      if (exists.get(pluginId)) continue;

      const canonical = JSON.stringify(parsed);
      const hash = createHash('sha256').update(canonical).digest('hex');
      insertStmt.run(randomUUID(), pluginId, parsed.version ?? '1.0.0', kind, hash, canonical);
      inserted++;
    }
  }
  if (inserted > 0) {
    log(`[migrate] seeded ${inserted} plugin_versions row(s) from on-disk catalog`);
  }
}

/** @param {string} p */
function safeStat(p) {
  try {
    return statSync(p);
  } catch {
    return null;
  }
}
