import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import type Database from 'better-sqlite3';

export interface DbTiming {
  ms: number;
  queries: number;
}

const timingStore = new AsyncLocalStorage<DbTiming>();

/** Process-wide counters, read and reset by the runtime metrics logger. */
export const dbCounters = { busy: 0 };

/** Runs `fn` with a fresh per-request DB timing accumulator. */
export function runWithDbTiming<T>(fn: () => T): { timing: DbTiming; result: T } {
  const timing: DbTiming = { ms: 0, queries: 0 };
  const result = timingStore.run(timing, fn);
  return { timing, result };
}

export function isBusyError(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code.startsWith('SQLITE_BUSY');
}

type StatementMethod = 'run' | 'get' | 'all';
type Method = (this: unknown, ...args: unknown[]) => unknown;
const TIMED: readonly StatementMethod[] = ['run', 'get', 'all'];
const PATCHED = Symbol.for('cropcard.dbTiming');

function timed(original: Method): Method {
  return function (this: unknown, ...args: unknown[]) {
    const timing = timingStore.getStore();
    if (!timing) {
      try {
        return original.apply(this, args);
      } catch (e) {
        if (isBusyError(e)) dbCounters.busy++;
        throw e;
      }
    }
    const start = performance.now();
    try {
      return original.apply(this, args);
    } catch (e) {
      if (isBusyError(e)) dbCounters.busy++;
      throw e;
    } finally {
      timing.ms += performance.now() - start;
      timing.queries++;
    }
  };
}

/** Times every statement run/get/all into the active request's accumulator
 *  and counts SQLITE_BUSY failures. Drizzle prepares a fresh statement per
 *  query, so the timing wrapper is installed once on better-sqlite3's shared
 *  Statement prototype instead of per statement; that also covers the
 *  BEGIN/COMMIT statements behind `db.transaction`. */
export function instrumentSqlite(sqlite: Database.Database): void {
  const proto = Object.getPrototypeOf(sqlite.prepare('SELECT 1')) as Record<
    StatementMethod,
    Method
  > & { [PATCHED]?: true };
  if (proto[PATCHED]) return;
  for (const name of TIMED) proto[name] = timed(proto[name]);
  proto[PATCHED] = true;
}
