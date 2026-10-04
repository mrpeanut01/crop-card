// @vitest-environment node
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { describe, expect, it } from 'vitest';

const source = join(__dirname, '../../../drizzle');
const TAG = '0086_remove_orchard_spray_tasks';

const REMOVED: Record<string, string[]> = {
  'pear-bartlett': ['dormant-oil', 'bloom', 'fire-blight-cover'],
  'peach-redhaven': ['dormant-spray', 'shuck-split-cover', 'summer-cover', 'pre-harvest'],
  'blueberry-bluecrop': ['mummy-berry-cover', 'anthracnose-pre-bloom'],
  'grape-concord': ['downy-mildew-cover', 'post-bloom-cover']
};

function folderWithout(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'mig0086-'));
  cpSync(source, dir, { recursive: true });
  const journalPath = join(dir, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { tag: string }[];
  };
  journal.entries = journal.entries.filter((e) => e.tag !== tag);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

function migrated(dir: string): Database.Database {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = OFF');
  migrate(drizzle(sqlite), { migrationsFolder: dir });
  return sqlite;
}

type Row = {
  id: string;
  aborted_at: number | null;
  abort_reason: string | null;
  completed_at: number | null;
};

describe(`migration ${TAG}`, () => {
  it('aborts only open tasks made from the removed spray rows', () => {
    const sqlite = migrated(folderWithout(TAG));
    const insert = sqlite.prepare(
      `INSERT INTO tasks (id, owner_id, title, kind, scheduled_for, completed_at, aborted_at,
         abort_reason, plugin_template_key, linked_to_task_id)
       VALUES (@id, 'owner_a', 't', @kind, 1, @completed, @aborted, @reason, @key, @linked)`
    );
    const add = (
      id: string,
      key: string | null,
      extra: Partial<{
        completed: number;
        aborted: number;
        reason: string;
        kind: string;
        linked: string;
      }> = {}
    ) =>
      insert.run({
        id,
        key,
        kind: extra.kind ?? 'primary',
        completed: extra.completed ?? null,
        aborted: extra.aborted ?? null,
        reason: extra.reason ?? null,
        linked: extra.linked ?? null
      });

    const openRemoved: string[] = [];
    for (const [pluginId, keys] of Object.entries(REMOVED)) {
      for (const key of keys) {
        const id = `open_${pluginId}_${key}`;
        add(id, `crop:${pluginId}:seasonal:${key}`);
        openRemoved.push(id);
      }
    }
    add('linked_prep', null, { kind: 'pre-task', linked: 'open_pear-bartlett_bloom' });
    add('done_removed', 'crop:peach-redhaven:seasonal:summer-cover', { completed: 500 });
    add('aborted_removed', 'crop:grape-concord:seasonal:post-bloom-cover', {
      aborted: 400,
      reason: 'skipped'
    });
    add('kept_harvest', 'crop:peach-redhaven:seasonal:harvest');
    add('kept_prune', 'crop:blueberry-bluecrop:seasonal:winter-prune');
    add('kept_swd', 'crop:blueberry-bluecrop:seasonal:swd-monitoring');
    add('other_crop', 'crop:pear-asian:seasonal:dormant-oil');
    add('manual', null);

    const before = Date.now();
    migrate(drizzle(sqlite), { migrationsFolder: source });
    const after = Date.now();

    const rows = new Map(
      (
        sqlite
          .prepare('SELECT id, aborted_at, abort_reason, completed_at FROM tasks')
          .all() as Row[]
      ).map((r) => [r.id, r])
    );

    for (const id of [...openRemoved, 'linked_prep']) {
      const r = rows.get(id)!;
      expect(r.abort_reason, id).toBe('Removed: unsourced spray advice');
      expect(r.aborted_at, id).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
      expect(r.aborted_at, id).toBeLessThanOrEqual(after + 1000);
      expect(r.completed_at, id).toBeNull();
    }
    expect(rows.get('done_removed')).toMatchObject({
      completed_at: 500,
      aborted_at: null,
      abort_reason: null
    });
    expect(rows.get('aborted_removed')).toMatchObject({ aborted_at: 400, abort_reason: 'skipped' });
    for (const id of ['kept_harvest', 'kept_prune', 'kept_swd', 'other_crop', 'manual']) {
      expect(rows.get(id), id).toMatchObject({ aborted_at: null, abort_reason: null });
    }
    sqlite.close();
  });

  it('lists every removed pear, peach, blueberry and grape key', () => {
    const sql = readFileSync(join(source, `${TAG}.sql`), 'utf8');
    for (const [pluginId, keys] of Object.entries(REMOVED)) {
      for (const key of keys) expect(sql).toContain(`'crop:${pluginId}:seasonal:${key}'`);
    }
  });
});
