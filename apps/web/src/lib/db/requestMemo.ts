/**
 * Request-scoped memo for reads that the root layout and a page load both
 * make (stock alerts, equipment history). Entries live on the active tenant
 * run, so they die with the request and never cross Owners, and each entry
 * is tagged with the database change marker so any write in between (a form
 * action, another request) forces a fresh read.
 */

import { db } from './client';
import { currentTenantMemo } from './tenant';

/** Builds a statement on first use and reuses it after, so hot reads skip
 *  Drizzle's query building and SQLite's prepare on every request. */
export function preparedOnce<T>(build: () => T): () => T {
  let stmt: T | undefined;
  return () => (stmt ??= build());
}

const changeMarkerStmt = preparedOnce(() =>
  db.$client.prepare<[], { c: number; v: number }>(
    'SELECT total_changes() AS c, (SELECT data_version FROM pragma_data_version) AS v'
  )
);

/** Changes whenever this process writes a row (`total_changes()`) or another
 *  connection commits (`data_version`). One row, no table access. */
export function dbChangeMarker(): string {
  const row = changeMarkerStmt().get()!;
  return `${row.c}:${row.v}`;
}

interface Entry {
  marker: string;
  value: unknown;
}

/** Returns `compute()`'s result, reusing it for the rest of the request while
 *  the database is unchanged. Outside a tenant run it just computes. Callers
 *  must treat the result as read-only. */
export function requestMemo<T>(key: string, compute: () => T): T {
  const memo = currentTenantMemo();
  if (!memo) return compute();
  const marker = dbChangeMarker();
  const hit = memo.get(key) as Entry | undefined;
  if (hit && hit.marker === marker) return hit.value as T;
  const value = compute();
  memo.set(key, { marker, value } satisfies Entry);
  return value;
}
