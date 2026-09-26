// @vitest-environment node
import { spawn } from 'node:child_process';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from './client';

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
