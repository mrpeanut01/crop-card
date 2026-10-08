// @vitest-environment node
import { spawn } from 'node:child_process';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from './client';
import { runShifted } from '../server/clock';

const WRITER = `
const db = new (require('better-sqlite3'))(process.env.DB_PATH);
db.pragma('busy_timeout = 5000');
const end = Date.now() + Number(process.env.MS);
const put = db.prepare("insert into _tx_probe (who) values ('writer')");
while (Date.now() < end) put.run();
`;

describe('db.transaction', () => {
  it('survives another connection committing between its read and its write', async () => {
    db.run(sql`create table if not exists _tx_probe (id integer primary key, who text)`);
    const ms = 1500;
    const writer = spawn(process.execPath, ['-e', WRITER], {
      env: {
        ...process.env,
        DB_PATH: process.env.DATABASE_URL!.replace(/^file:/, ''),
        MS: String(ms)
      },
      stdio: 'inherit'
    });
    const exited = new Promise((resolve) => writer.on('exit', resolve));
    await new Promise((r) => setTimeout(r, 100));

    const errors: string[] = [];
    let commits = 0;
    const end = Date.now() + ms - 200;
    while (Date.now() < end) {
      try {
        db.transaction(() => {
          db.get(sql`select count(*) from _tx_probe`);
          db.run(sql`insert into _tx_probe (who) values ('app')`);
        });
        commits++;
      } catch (e) {
        errors.push((e as { code?: string }).code ?? String(e));
      }
      await new Promise((r) => setImmediate(r));
    }
    await exited;
    expect(errors).toEqual([]);
    expect(commits).toBeGreaterThan(0);
  }, 15_000);
});

describe('SQL default save times follow the request clock', () => {
  const DAY = 86_400_000;
  const WINDOW = 48 * 60 * 60 * 1000;

  function stamp(): number {
    db.run(
      sql`create table if not exists _clock_probe (id integer primary key, created_at integer not null default (unixepoch() * 1000))`
    );
    const row = db.get<{ created_at: number }>(
      sql`insert into _clock_probe default values returning created_at`
    );
    return row.created_at;
  }

  it('stamps the real time on a real farm, as the built-in does', () => {
    const before = Math.floor(Date.now() / 1000) * 1000;
    const at = stamp();
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
    const builtin = db.get<{ u: number }>(sql`select unixepoch('2020-01-01') as u`);
    expect(builtin.u).toBe(1577836800);
  });

  it('stamps the demo date inside a fast-forwarded request, so the 48 h window holds', async () => {
    const offset = 120 * DAY;
    const { at, insideWindow } = await runShifted(offset, async () => {
      const at = stamp();
      return { at, insideWindow: Date.now() - at <= WINDOW };
    });
    expect(at).toBeGreaterThan(Date.now() + offset - 60_000);
    expect(insideWindow).toBe(true);
    const later = stamp();
    expect(later).toBeLessThanOrEqual(Date.now());
    expect(later).toBeLessThan(at - offset + 60_000);
  });
});
