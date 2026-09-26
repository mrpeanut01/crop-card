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
const TIMED: readonly StatementMethod[] = ['run', 'get', 'all'];

/** Times every statement run/get/all into the active request's accumulator
 *  and counts SQLITE_BUSY failures. Statements are wrapped per instance so
 *  `stmt.raw()` (which returns the same object) keeps the wrapper. */
export function instrumentSqlite(sqlite: Database.Database): void {
  const prepare = sqlite.prepare.bind(sqlite);
  sqlite.prepare = ((source: string) => {
    const stmt = prepare(source) as unknown as Record<
      StatementMethod,
      (...a: unknown[]) => unknown
    >;
    for (const name of TIMED) {
      const original = stmt[name].bind(stmt);
      stmt[name] = (...args: unknown[]) => {
        const timing = timingStore.getStore();
        const start = timing ? performance.now() : 0;
        try {
          return original(...args);
        } catch (e) {
          if (isBusyError(e)) dbCounters.busy++;
          throw e;
        } finally {
          if (timing) {
            timing.ms += performance.now() - start;
            timing.queries++;
          }
        }
      };
    }
    return stmt;
  }) as typeof sqlite.prepare;
}
