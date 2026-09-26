/**
 * Low-overhead runtime metrics: event-loop delay percentiles, request and
 * DB time totals, SQLITE_BUSY count and WAL size, logged as one terse JSON
 * line per interval (only when something happened), plus a Server-Timing
 * header on every response.
 */

import { statSync } from 'node:fs';
import { monitorEventLoopDelay, performance, type IntervalHistogram } from 'node:perf_hooks';
import type { Handle } from '@sveltejs/kit';
import { databasePath } from '$lib/db/client';
import { dbCounters, runWithDbTiming } from '$lib/db/instrument';

const DEFAULT_INTERVAL_MS = 10 * 60_000;
const SLOW_LOOP_MS = 100;

const win = { requests: 0, dbMs: 0 };

export function noteRequest(dbMs: number): void {
  win.requests++;
  win.dbMs += dbMs;
}

export function walSizeBytes(path = databasePath()): number | null {
  try {
    return statSync(`${path}-wal`).size;
  } catch {
    return null;
  }
}

const nsToMs = (ns: number) => Math.round(ns / 1e4) / 100;

export interface MetricsLine {
  eld_p50_ms: number;
  eld_p99_ms: number;
  eld_max_ms: number;
  req: number;
  db_ms: number;
  busy: number;
  wal_kb: number | null;
}

/** Snapshot and reset the current window. Returns null when idle. */
export function takeMetricsLine(h: IntervalHistogram): MetricsLine | null {
  const line: MetricsLine = {
    eld_p50_ms: nsToMs(h.percentile(50)),
    eld_p99_ms: nsToMs(h.percentile(99)),
    eld_max_ms: nsToMs(h.max),
    req: win.requests,
    db_ms: Math.round(win.dbMs),
    busy: dbCounters.busy,
    wal_kb: null
  };
  h.reset();
  win.requests = 0;
  win.dbMs = 0;
  dbCounters.busy = 0;
  if (line.req === 0 && line.busy === 0 && line.eld_max_ms < SLOW_LOOP_MS) return null;
  const wal = walSizeBytes();
  line.wal_kb = wal === null ? null : Math.round(wal / 1024);
  return line;
}

const GLOBAL_KEY = Symbol.for('cropcard.runtimeMetrics');

export function startRuntimeMetrics(
  env: Record<string, string | undefined> = process.env
): boolean {
  if (env.NODE_ENV === 'test' || env.VITEST === 'true' || env.PERF_LOG === 'off') return false;
  const g = globalThis as Record<symbol, boolean | undefined>;
  if (g[GLOBAL_KEY]) return false;
  g[GLOBAL_KEY] = true;
  const h = monitorEventLoopDelay({ resolution: 20 });
  h.enable();
  const interval = Number(env.PERF_LOG_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
  const t = setInterval(() => {
    const line = takeMetricsLine(h);
    if (line) console.log('[perf]', JSON.stringify(line));
  }, interval);
  t.unref?.();
  return true;
}

export function serverTimingValue(totalMs: number, dbMs: number, queries: number): string {
  return `db;dur=${dbMs.toFixed(1)};desc="${queries}q", total;dur=${totalMs.toFixed(1)}`;
}

/** Wraps the app's handle: times the request and the DB statements it ran. */
export const withServerTiming =
  (inner: Handle): Handle =>
  async (input) => {
    const start = performance.now();
    const { timing, result } = runWithDbTiming(() => inner(input));
    const response = await result;
    noteRequest(timing.ms);
    try {
      response.headers.append(
        'Server-Timing',
        serverTimingValue(performance.now() - start, timing.ms, timing.queries)
      );
    } catch {
      // Immutable headers (a proxied fetch response); skip the header.
    }
    return response;
  };
