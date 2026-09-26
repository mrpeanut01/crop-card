import Database from 'better-sqlite3';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { sqliteHandle } from '$lib/db/client';
import { dbCounters, instrumentSqlite, runWithDbTiming } from '$lib/db/instrument';
import {
  noteRequest,
  withServerTiming,
  serverTimingValue,
  startRuntimeMetrics,
  takeMetricsLine
} from './runtimeMetrics';

describe('connection pragmas', () => {
  it('keeps WAL for Litestream and applies the cache / mmap / temp settings', () => {
    const s = sqliteHandle();
    expect(s.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(s.pragma('synchronous', { simple: true })).toBe(1);
    expect(s.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(s.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(s.pragma('cache_size', { simple: true })).toBe(-65536);
    expect(s.pragma('temp_store', { simple: true })).toBe(2);
    expect(s.pragma('journal_size_limit', { simple: true })).toBe(67108864);
    expect(s.pragma('wal_autocheckpoint', { simple: true })).toBe(1000);
    expect(s.pragma('analysis_limit', { simple: true })).toBe(1000);
  });
});

describe('instrumentSqlite', () => {
  it('times statements run inside a request, including raw()', () => {
    const db = new Database(':memory:');
    instrumentSqlite(db);
    db.exec('CREATE TABLE t (x)');
    const { timing } = runWithDbTiming(() => {
      db.prepare('INSERT INTO t VALUES (1)').run();
      db.prepare('SELECT x FROM t').all();
      db.prepare('SELECT x FROM t').raw().get();
    });
    expect(timing.queries).toBe(3);
    expect(timing.ms).toBeGreaterThanOrEqual(0);
  });

  it('wraps once however many connections are instrumented', () => {
    const a = new Database(':memory:');
    const b = new Database(':memory:');
    instrumentSqlite(a);
    instrumentSqlite(b);
    instrumentSqlite(b);
    const { timing } = runWithDbTiming(() => {
      a.prepare('SELECT 1').get();
      b.prepare('SELECT 1').get();
    });
    expect(timing.queries).toBe(2);
    a.close();
    b.close();
  });

  it('keeps per-request totals apart across interleaved async requests', async () => {
    const db = new Database(':memory:');
    instrumentSqlite(db);
    const tick = () => new Promise((r) => setTimeout(r, 1));
    const req = (n: number) =>
      runWithDbTiming(async () => {
        for (let i = 0; i < n; i++) {
          await tick();
          db.prepare('SELECT 1').get();
        }
      });
    const [x, y] = [req(2), req(5)];
    await Promise.all([x.result, y.result]);
    expect(x.timing.queries).toBe(2);
    expect(y.timing.queries).toBe(5);
    db.close();
  });

  it('counts SQLITE_BUSY failures', () => {
    const file = join(tmpdir(), `cropcard-busy-${process.pid}-${Date.now()}.db`);
    const a = new Database(file);
    const b = new Database(file, { timeout: 0 });
    instrumentSqlite(b);
    a.exec('CREATE TABLE t (x)');
    a.exec('BEGIN IMMEDIATE');
    const before = dbCounters.busy;
    expect(() => b.prepare('INSERT INTO t VALUES (1)').run()).toThrow();
    expect(dbCounters.busy).toBe(before + 1);
    a.exec('ROLLBACK');
    a.close();
    b.close();
    for (const suffix of ['', '-wal', '-shm']) rmSync(file + suffix, { force: true });
  });
});

describe('metrics line', () => {
  it('is null when nothing happened, terse JSON when something did', () => {
    const h = monitorEventLoopDelay({ resolution: 20 });
    takeMetricsLine(h);
    expect(takeMetricsLine(h)).toBeNull();
    noteRequest(12.4);
    const line = takeMetricsLine(h);
    expect(line).toMatchObject({ req: 1, db_ms: 12 });
    expect(Object.keys(line!)).toEqual([
      'eld_p50_ms',
      'eld_p99_ms',
      'eld_max_ms',
      'req',
      'db_ms',
      'busy',
      'wal_kb'
    ]);
  });

  it('never starts under tests', () => {
    expect(startRuntimeMetrics()).toBe(false);
  });
});

describe('Server-Timing', () => {
  it('formats db + total durations', () => {
    expect(serverTimingValue(12.345, 1.2, 3)).toBe('db;dur=1.2;desc="3q", total;dur=12.3');
  });

  it('adds the header with the DB time spent resolving the request', async () => {
    const res = await withServerTiming(({ resolve }) => resolve({} as never))({
      event: {} as never,
      resolve: async () => {
        sqliteHandle().prepare('SELECT 1').get();
        return new Response('ok');
      }
    });
    expect(res.headers.get('server-timing')).toMatch(/^db;dur=[\d.]+;desc="1q", total;dur=/);
  });

  it('leaves immutable responses alone', async () => {
    const immutable = Response.redirect('http://localhost/x', 302);
    const res = await withServerTiming(({ resolve }) => resolve({} as never))({
      event: {} as never,
      resolve: async () => immutable
    });
    expect(res.status).toBe(302);
  });
});
