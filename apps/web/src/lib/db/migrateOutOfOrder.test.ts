// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { applyOutOfOrderMigrations } from '../../../scripts/migrateOutOfOrder.mjs';

type Entry = { idx: number; when: number; tag: string; sql: string };

function folder(entries: Entry[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'mig-'));
  mkdirSync(join(dir, 'meta'));
  writeFileSync(
    join(dir, 'meta/_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'sqlite',
      entries: entries.map((e) => ({
        idx: e.idx,
        version: '6',
        when: e.when,
        tag: e.tag,
        breakpoints: true
      }))
    })
  );
  for (const e of entries) writeFileSync(join(dir, `${e.tag}.sql`), e.sql);
  return dir;
}

const base: Entry = { idx: 69, when: 1000, tag: '0069_base', sql: 'CREATE TABLE a (id text);' };
const theirs: Entry[] = [
  { idx: 70, when: 2000, tag: '0070_theirs', sql: 'CREATE TABLE t70 (id text);' },
  {
    idx: 71,
    when: 2100,
    tag: '0071_theirs',
    sql: 'ALTER TABLE a ADD b text;\n--> statement-breakpoint\nCREATE TABLE t71 (id text);'
  }
];
const ours: Entry = { idx: 74, when: 5000, tag: '0074_ours', sql: 'CREATE TABLE t74 (id text);' };

function migrateWith(dbPath: string, dir: string) {
  execFileSync('node', ['./scripts/migrate.mjs'], {
    env: {
      ...process.env,
      DATABASE_URL: `file:${dbPath}`,
      MIGRATIONS_FOLDER: dir,
      PLUGINS_DIR: dir
    },
    stdio: 'pipe'
  });
}

function tables(dbPath: string): string[] {
  const db = new Database(dbPath, { readonly: true });
  const names = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite_%'`
    )
    .all()
    .map((r) => (r as { name: string }).name)
    .sort();
  db.close();
  return names;
}

describe('migrate.mjs with branches merged in either order', () => {
  it('applies migrations stamped before the last applied one instead of skipping them', () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'migdb-')), 'x.db');
    migrateWith(dbPath, folder([base, ours]));
    expect(tables(dbPath)).toEqual(['a', 't74']);
    migrateWith(dbPath, folder([base, ...theirs, ours]));
    expect(tables(dbPath)).toEqual(['a', 't70', 't71', 't74']);
    migrateWith(dbPath, folder([base, ...theirs, ours]));
    const db = new Database(dbPath, { readonly: true });
    expect(db.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').get()).toEqual({ n: 4 });
    db.close();
  });

  it('does not replay an applied migration whose file was reformatted later', () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'migdb-')), 'x.db');
    migrateWith(dbPath, folder([base, ...theirs, ours]));
    const edited = { ...theirs[0], sql: '-- tidy\nCREATE TABLE t70 (id text);' };
    const db = new Database(dbPath);
    expect(
      applyOutOfOrderMigrations(db, folder([base, edited, theirs[1], ours]), () => {})
    ).toEqual([]);
    db.close();
  });

  it('stops the boot when an out-of-order migration cannot apply', () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'migdb-')), 'x.db');
    migrateWith(dbPath, folder([base, ours]));
    const bad = { ...theirs[0], sql: 'ALTER TABLE missing ADD c text;' };
    expect(() => migrateWith(dbPath, folder([base, bad, ours]))).toThrow();
    expect(tables(dbPath)).toEqual(['a', 't74']);
  });
});
