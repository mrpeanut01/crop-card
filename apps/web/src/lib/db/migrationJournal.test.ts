import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(__dirname, '../../../drizzle');
// Migrations before this index predate the checks below (missing snapshots,
// hand-set timestamps) and are already applied everywhere.
const CHECKED_FROM = 40;

const journal = JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')) as {
  entries: { idx: number; when: number; tag: string }[];
};

describe('drizzle migration journal', () => {
  it('lists every SQL file once, with a snapshot, and nothing extra', () => {
    const sql = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => f.replace(/\.sql$/, ''))
      .sort();
    expect(journal.entries.map((e) => e.tag).sort()).toEqual(sql);
    for (const e of journal.entries) {
      if (e.idx < CHECKED_FROM) continue;
      const prefix = e.tag.slice(0, 4);
      expect(Number(prefix)).toBe(e.idx);
      expect(existsSync(join(dir, `meta/${prefix}_snapshot.json`))).toBe(true);
    }
  });

  it('keeps numbers unique and increasing', () => {
    const prefixes = journal.entries.map((e) => e.tag.slice(0, 4));
    expect(new Set(prefixes).size).toBe(prefixes.length);
    for (let i = 1; i < journal.entries.length; i++) {
      expect(journal.entries[i].idx).toBeGreaterThan(journal.entries[i - 1].idx);
    }
  });

  it('keeps `when` strictly increasing, since the migrator skips anything older than the last applied one', () => {
    for (let i = 1; i < journal.entries.length; i++) {
      if (journal.entries[i].idx <= CHECKED_FROM) continue;
      expect(journal.entries[i].when, journal.entries[i].tag).toBeGreaterThan(
        journal.entries[i - 1].when
      );
    }
  });

  it('chains each snapshot to the one before it, so a merge of two branches cannot fork the chain', () => {
    const snap = (e: { tag: string }) =>
      JSON.parse(readFileSync(join(dir, `meta/${e.tag.slice(0, 4)}_snapshot.json`), 'utf8')) as {
        id: string;
        prevId: string;
      };
    const checked = journal.entries.filter((e) => e.idx >= CHECKED_FROM);
    for (let i = 1; i < checked.length; i++) {
      expect(
        snap(checked[i]).prevId,
        `${checked[i].tag} must follow ${checked[i - 1].tag}. After merging another branch's migrations, point this snapshot's prevId at the one before it and regenerate the later snapshots from schema.ts`
      ).toBe(snap(checked[i - 1]).id);
    }
  });
});
