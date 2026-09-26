import { db } from '$lib/db/client';
import { markClientRecordSaved } from './clientRecordId';

/** Runs a record endpoint's writes (event row, sprayer state, stock
 *  movements, task close, replay receipt) as one SQLite transaction, so a
 *  failure part-way leaves nothing behind and an offline replay can retry.
 *  `fn` must be synchronous: resolve anything async before calling. */
export function writeRecord<T>(event: { request: Request }, fn: () => T): T {
  return db.transaction(() => {
    const out = fn();
    markClientRecordSaved(event);
    return out;
  });
}

export type BestEffort<T> = { ok: true; value: T } | { ok: false; error: unknown };

/** A warn-don't-block step inside writeRecord. Runs under a savepoint, so a
 *  throw undoes only this step's partial writes and is returned, not raised. */
export function bestEffort<T>(fn: () => T): BestEffort<T> {
  try {
    return { ok: true, value: db.transaction(() => fn()) };
  } catch (error) {
    return { ok: false, error };
  }
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
