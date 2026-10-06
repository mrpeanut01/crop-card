// @vitest-environment node
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { describe, expect, it } from 'vitest';
import { textRefreshMigrationSql, type TextRefreshRow } from './textRefreshMigration';

// OP-27: `orchardSeasonalTasks` is retired, so the engine has no
// `orchard-task` kind. Migration 0089 renames scheduled-suggestion keys to
// `derived:seasonal-task:` and leaves every task's text, status and dates
// alone (the 562 panel left a scheduled apple harvest task to the farmer).

const source = join(__dirname, '../../../drizzle');
const TAG = '0089_retire_orchard_seasonal_tasks';
const rows = JSON.parse(
  readFileSync(join(__dirname, '../../../scripts/seasonal-text-refresh-0089.json'), 'utf8')
) as TextRefreshRow[];

function folderWithout(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'mig0089-'));
  cpSync(source, dir, { recursive: true });
  const journalPath = join(dir, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
  journal.entries = journal.entries.slice(
    0,
    journal.entries.findIndex((e) => e.tag === tag)
  );
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

describe('migration 0089_retire_orchard_seasonal_tasks', () => {
  it('is exactly what the generator writes', () => {
    expect(rows).toEqual([]);
    expect(readFileSync(join(source, `${TAG}.sql`), 'utf8')).toBe(
      textRefreshMigrationSql(rows, { prefix: 'm0089', retireOrchardTaskKeys: true })
    );
  });

  it('renames orchard-task keys, keeps a key the Owner already holds, and touches nothing else', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = OFF');
    migrate(drizzle(sqlite), { migrationsFolder: folderWithout(TAG) });
    const insert = sqlite.prepare(
      `INSERT INTO tasks (id, owner_id, title, body, kind, scheduled_for, completed_at, aborted_at,
         plugin_template_key) VALUES (@id, @owner, @title, @body, 'primary', 1, @done, NULL, @key)`
    );
    const add = (id: string, owner: string, key: string | null, done: number | null = null) =>
      insert.run({ id, owner, key, done, title: `T ${id}`, body: `B ${id}` });
    add('thin', 'owner_a', 'derived:orchard-task:b1:1780000000000');
    add('harvest', 'owner_a', 'derived:orchard-task:b1:1790000000000');
    add('closed', 'owner_a', 'derived:orchard-task:b2:1700000000000', 5);
    add('dupe', 'owner_a', 'derived:orchard-task:b3:1');
    add('held', 'owner_a', 'derived:seasonal-task:b3:1');
    add('other-owner', 'owner_b', 'derived:orchard-task:b3:1');
    add('seasonal', 'owner_a', 'crop:apple-orchard:seasonal:post-bloom-thinning');
    add('plain', 'owner_a', null);
    const before = sqlite
      .prepare('SELECT id, title, body, completed_at, aborted_at FROM tasks')
      .all();

    migrate(drizzle(sqlite), { migrationsFolder: source });

    const keys = new Map(
      (
        sqlite.prepare('SELECT id, plugin_template_key AS k FROM tasks').all() as {
          id: string;
          k: string | null;
        }[]
      ).map((r) => [r.id, r.k])
    );
    expect(keys.get('thin')).toBe('derived:seasonal-task:b1:1780000000000');
    expect(keys.get('harvest')).toBe('derived:seasonal-task:b1:1790000000000');
    expect(keys.get('closed')).toBe('derived:seasonal-task:b2:1700000000000');
    expect(keys.get('dupe')).toBe('derived:orchard-task:b3:1');
    expect(keys.get('held')).toBe('derived:seasonal-task:b3:1');
    expect(keys.get('other-owner')).toBe('derived:seasonal-task:b3:1');
    expect(keys.get('seasonal')).toBe('crop:apple-orchard:seasonal:post-bloom-thinning');
    expect(keys.get('plain')).toBeNull();
    expect(
      sqlite.prepare('SELECT id, title, body, completed_at, aborted_at FROM tasks').all()
    ).toEqual(before);
  });
});
