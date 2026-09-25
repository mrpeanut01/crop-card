import { json } from '@sveltejs/kit';

/**
 * Invariant 6 — a row stamped with the caller's owner_id must not reference
 * another Owner's rows. SQLite FKs don't help (the foreign row exists), so
 * each id taken from a request body is resolved through its tenant-scoped
 * getter, which returns undefined for another Owner's ids.
 */
export type ForeignRef = readonly [
  field: string,
  id: string | null | undefined,
  exists: (id: string) => unknown
];

export function firstUnknownRef(...refs: ForeignRef[]): string | null {
  for (const [field, id, exists] of refs) {
    if (id && !exists(id)) return field;
  }
  return null;
}

/** 400 `{ error: 'unknown <field>' }` for the first unresolvable reference. */
export function rejectForeignRefs(...refs: ForeignRef[]): Response | null {
  const field = firstUnknownRef(...refs);
  return field ? json({ error: `unknown ${field}` }, { status: 400 }) : null;
}
