// @vitest-environment node
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { describe, expect, it } from 'vitest';
import {
  textRefreshMigrationSql,
  validateTextRefreshRows,
  type TextRefreshRow
} from './textRefreshMigration';

const source = join(__dirname, '../../../drizzle');
const TAG = '0087_seasonal_text_refresh';
const ROWS_FILE = join(__dirname, '../../../scripts/seasonal-text-refresh-0087.json');
const PLUGINS = join(__dirname, '../../../../../plugins/crops');
const rows = JSON.parse(readFileSync(ROWS_FILE, 'utf8')) as TextRefreshRow[];

function folderWithout(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'mig0087-'));
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

type Row = {
  id: string;
  title: string;
  body: string | null;
  aborted_at: number | null;
  abort_reason: string | null;
};

function freshDb(dir: string) {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = OFF');
  migrate(drizzle(sqlite), { migrationsFolder: dir });
  const insert = sqlite.prepare(
    `INSERT INTO tasks (id, owner_id, title, body, kind, scheduled_for, completed_at, aborted_at,
       abort_reason, plugin_template_key, linked_to_task_id)
     VALUES (@id, 'owner_a', @title, @body, @kind, 1, @completed, @aborted, NULL, @key, @linked)`
  );
  const add = (
    id: string,
    key: string | null,
    title: string,
    body: string | null,
    extra: Partial<{ completed: number; aborted: number; kind: string; linked: string }> = {}
  ) =>
    insert.run({
      id,
      key,
      title,
      body,
      kind: extra.kind ?? 'primary',
      completed: extra.completed ?? null,
      aborted: extra.aborted ?? null,
      linked: extra.linked ?? null
    });
  const read = () =>
    new Map(
      (
        sqlite.prepare('SELECT id, title, body, aborted_at, abort_reason FROM tasks').all() as Row[]
      ).map((r) => [r.id, r])
    );
  return { sqlite, add, read };
}

describe('textRefreshMigrationSql (OP-21 generator)', () => {
  const edit: TextRefreshRow = {
    templateKey: 'crop:test-crop:seasonal:prune',
    oldTitle: 'Tip at 4 ft',
    newTitle: 'Tip at about 5 ft',
    oldBody: "Keep the year's canes.",
    newBody: "Keep this year's canes."
  };
  const bodyOnly: TextRefreshRow = {
    templateKey: null,
    oldTitle: 'Harvest window',
    newTitle: 'Harvest window',
    oldBody: 'Pick every 5–7 d.',
    newBody: 'Pick often.'
  };
  const gone: TextRefreshRow = {
    templateKey: 'crop:test-crop:seasonal:spray',
    oldTitle: 'Old spray',
    newTitle: 'Old spray',
    oldBody: 'Spray it.',
    newBody: null,
    removed: true
  };

  it('refuses rows that change nothing or map one old text to two new ones', () => {
    expect(
      validateTextRefreshRows([{ ...edit, newTitle: edit.oldTitle, newBody: edit.oldBody }])
    ).toEqual(['crop:test-crop:seasonal:prune: nothing changes']);
    expect(
      validateTextRefreshRows([
        edit,
        { ...edit, templateKey: 'crop:x:seasonal:y', newTitle: 'Other' }
      ])
    ).toEqual(['crop:x:seasonal:y: old title "Tip at 4 ft" maps to two new titles']);
    expect(validateTextRefreshRows([{ ...edit, templateKey: 'derived:seasonal-task:x' }])).toEqual([
      'derived:seasonal-task:x: template key is not a crop seasonal key'
    ]);
    expect(() =>
      textRefreshMigrationSql([{ ...edit, newTitle: edit.oldTitle, newBody: edit.oldBody }], {
        prefix: 'm1'
      })
    ).toThrow();
  });

  it('rewrites only open tasks whose text still equals the old text, and skips removed rows', () => {
    const dir = folderWithout(TAG);
    const sqlPath = join(dir, '9999_test.sql');
    writeFileSync(
      sqlPath,
      textRefreshMigrationSql([edit, bodyOnly, gone], {
        prefix: 'mtest',
        abortReason: 'Removed: test'
      })
    );
    const { sqlite, add, read } = freshDb(dir);
    add('crop_both', edit.templateKey, edit.oldTitle, edit.oldBody);
    add('crop_farmer_title', edit.templateKey, 'My tipping', edit.oldBody);
    add('crop_farmer_body', edit.templateKey, edit.oldTitle, 'my note');
    add('crop_done', edit.templateKey, edit.oldTitle, edit.oldBody, { completed: 5 });
    add('crop_skipped', edit.templateKey, edit.oldTitle, edit.oldBody, { aborted: 5 });
    add('crop_other_key', 'crop:other:seasonal:prune', edit.oldTitle, edit.oldBody);
    add(
      'derived_title',
      'derived:seasonal-task:blk:1',
      `${edit.oldTitle} — Triple Crown`,
      edit.oldBody
    );
    add('derived_edited', 'derived:orchard-task:blk:2', `${edit.oldTitle} (mine) — Gala`, 'mine');
    add('derived_body', 'derived:orchard-task:blk:3', 'Harvest window — Gala', bodyOnly.oldBody);
    add('scout_key', 'derived:scout:blk:4', `${edit.oldTitle} — X`, bodyOnly.oldBody);
    add('removed_open', gone.templateKey, gone.oldTitle, gone.oldBody);
    add('removed_prep', null, 'Fill tank', null, { kind: 'pre-task', linked: 'removed_open' });
    add('removed_derived', 'derived:seasonal-task:blk:5', `${gone.oldTitle} — Y`, 'edited');
    sqlite.exec(readFileSync(sqlPath, 'utf8').split('--> statement-breakpoint').join('\n'));
    const r = read();
    expect(r.get('crop_both')).toMatchObject({ title: edit.newTitle, body: edit.newBody });
    expect(r.get('crop_farmer_title')).toMatchObject({ title: 'My tipping', body: edit.newBody });
    expect(r.get('crop_farmer_body')).toMatchObject({ title: edit.newTitle, body: 'my note' });
    expect(r.get('crop_done')).toMatchObject({ title: edit.oldTitle, body: edit.oldBody });
    expect(r.get('crop_skipped')).toMatchObject({ title: edit.oldTitle, body: edit.oldBody });
    expect(r.get('crop_other_key')).toMatchObject({ title: edit.oldTitle, body: edit.oldBody });
    expect(r.get('derived_title')).toMatchObject({
      title: `${edit.newTitle} — Triple Crown`,
      body: edit.newBody
    });
    expect(r.get('derived_edited')).toMatchObject({
      title: `${edit.oldTitle} (mine) — Gala`,
      body: 'mine'
    });
    expect(r.get('derived_body')).toMatchObject({
      title: 'Harvest window — Gala',
      body: bodyOnly.newBody
    });
    expect(r.get('scout_key')).toMatchObject({
      title: `${edit.oldTitle} — X`,
      body: bodyOnly.oldBody
    });
    for (const id of ['removed_open', 'removed_prep', 'removed_derived']) {
      expect(r.get(id)?.abort_reason, id).toBe('Removed: test');
    }
    for (const id of ['crop_both', 'derived_title', 'derived_body']) {
      expect(r.get(id)?.aborted_at, id).toBeNull();
    }
    sqlite.close();
  });
});

describe(`migration ${TAG}`, () => {
  it('is exactly what the generator writes from its rows file', () => {
    expect(readFileSync(join(source, `${TAG}.sql`), 'utf8')).toBe(
      textRefreshMigrationSql(rows, { prefix: 'm0087' })
    );
  });

  it('carries each edited row from its old text to the text the plugin ships now', () => {
    const shipped = new Map<string, { title: string; body?: string }>();
    for (const r of rows) {
      const key = r.templateKey ?? 'crop:apple-orchard:seasonal:harvest';
      const [, pluginId, , rowKey] = key.split(':');
      const plugin = JSON.parse(readFileSync(join(PLUGINS, `${pluginId}.json`), 'utf8')) as Record<
        string,
        { key: string; title: string; body?: string }[] | undefined
      >;
      const row = [...(plugin.seasonalTasks ?? []), ...(plugin.orchardSeasonalTasks ?? [])].find(
        (x) => x.key === rowKey
      );
      expect(row, key).toBeDefined();
      shipped.set(key, row!);
      expect(r.newTitle, key).toBe(row!.title);
      expect(r.newBody, key).toBe(row!.body ?? null);
      expect(/\d/.test(r.oldTitle + (r.oldBody ?? '')) || r.oldBody?.includes('(above)'), key).toBe(
        true
      );
    }
    expect(shipped.size).toBe(rows.length);
  });

  it('refreshes open tasks on a migrated database and keeps a farmer edit', () => {
    const { sqlite, add, read } = freshDb(folderWithout(TAG));
    const frost = rows.find((r) => r.templateKey === 'crop:strawberry-jewel:seasonal:frost-watch')!;
    const apple = rows.find((r) => r.templateKey === null)!;
    const tip = rows.find(
      (r) => r.templateKey === 'crop:blackberry-triple-crown:seasonal:tip-primocanes'
    )!;
    add('frost', frost.templateKey, frost.oldTitle, frost.oldBody);
    add('frost_mine', frost.templateKey, frost.oldTitle, 'Cover with sheets');
    add('apple', 'derived:orchard-task:blk:1', `${apple.oldTitle} — Gala`, apple.oldBody);
    add('tip', 'derived:seasonal-task:blk:2', `${tip.oldTitle} — Triple Crown`, tip.oldBody);
    migrate(drizzle(sqlite), { migrationsFolder: source });
    const r = read();
    expect(r.get('frost')).toMatchObject({ title: frost.newTitle, body: frost.newBody });
    expect(r.get('frost_mine')).toMatchObject({ body: 'Cover with sheets' });
    expect(r.get('apple')).toMatchObject({
      title: `${apple.newTitle} — Gala`,
      body: apple.newBody
    });
    expect(r.get('tip')).toMatchObject({ title: `${tip.newTitle} — Triple Crown` });
    sqlite.close();
  });
});
