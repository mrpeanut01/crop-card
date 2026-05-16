/**
 * Tenant scoping primitives.
 *
 * CropCard runs as a multi-tenant SaaS: many Owners share one SQLite database,
 * with row-level isolation via an `owner_id` column on every operational
 * table. The runtime guarantee — "a request only sees its own Owner's data"
 * — rides on three redundant gates so a careless author trips at least one:
 *
 *   1. **Request-scoped tenant context**, kept in Node's AsyncLocalStorage by
 *      `hooks.server.ts` (`runWithTenant(activeOwnerId, () => resolve(event))`).
 *      Repos read it via `requireOwnerId()` which throws when no context is
 *      set — fail closed for any background job or unauthenticated route.
 *
 *   2. **Scoped helpers** (`tenantWhere`, `withTenant`, `tenantValues`) that
 *      every repo MUST funnel its Drizzle queries through. They take a table
 *      and auto-inject `eq(table.ownerId, requireOwnerId())` into reads and
 *      `{ ownerId: requireOwnerId() }` into writes. The `TenantScoped` brand
 *      makes calling these helpers on a global table (e.g. `taxonomyTerms`)
 *      a compile error.
 *
 *   3. **ESLint rule** (`apps/web/eslint/no-raw-tenant-table.js`) that flags
 *      `db.select().from(<branded table>)` and steers authors to the helpers
 *      above. Whitelisted only for this module + scoped/admin helpers.
 *
 * Intentionally-global tables (`taxonomyTerms` defaults, `weatherForecastCache`,
 * `users` for cross-tenant lookups, `owners` + `helper_assignments` themselves)
 * use `unscopedQueryNote` to make the intent screamingly visible at the call
 * site — the name is awful on purpose.
 *
 * Server-only. Imported into route handlers via `$lib/db/*` repos.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { type SQL, and, eq } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

// ─── Tenant-scoped table brand ──────────────────────────────────────────
//
// The brand is a TypeScript-only marker. A tenant-scoped schema table casts
// itself to `T & TenantScoped` at definition time. The branded type carries
// a discoverable `ownerId` column so the helpers below can type-check both
// the brand AND the column existence with one constraint.

export const TENANT_SCOPED_BRAND: unique symbol = Symbol('tenant-scoped');

export type TenantScoped = {
  readonly [TENANT_SCOPED_BRAND]: true;
  readonly ownerId: SQLiteTable['_']['columns'][string];
};

export type TenantScopedTable = SQLiteTable & TenantScoped;

// ─── Request-scoped context ─────────────────────────────────────────────

const storage = new AsyncLocalStorage<{ ownerId: string }>();

/** Run `fn` with `ownerId` bound as the active tenant. Repos called inside
 *  `fn` see `requireOwnerId() === ownerId`. Outside any `runWithTenant`,
 *  `requireOwnerId()` throws — fail-closed by default. */
export function runWithTenant<T>(ownerId: string, fn: () => T): T {
  if (!ownerId || typeof ownerId !== 'string') {
    throw new Error('runWithTenant: ownerId must be a non-empty string');
  }
  return storage.run({ ownerId }, fn);
}

/** Like `runWithTenant`, but the wrapped `fn` is awaited. Useful in tests
 *  and async route handlers where the body returns a Promise. */
export function runWithTenantAsync<T>(ownerId: string, fn: () => Promise<T>): Promise<T> {
  if (!ownerId || typeof ownerId !== 'string') {
    throw new Error('runWithTenantAsync: ownerId must be a non-empty string');
  }
  return storage.run({ ownerId }, fn);
}

/** Current active tenant, or null if no context is set. Most code wants
 *  `requireOwnerId()`; this lower-level escape hatch exists for the few
 *  places (login, signup, superadmin lookup) that legitimately need to act
 *  outside a tenant. */
export function currentOwnerId(): string | null {
  return storage.getStore()?.ownerId ?? null;
}

/** Throws if called outside a `runWithTenant` block. Used by the scoped
 *  helpers below — every tenant-scoped DB query goes through one of them,
 *  so forgetting the wrapper produces a loud failure, not a silent leak.
 *
 *  Exception: under vitest (`process.env.VITEST === 'true'`), falls back to
 *  the Home Farm id seeded by migration 0021. This keeps the legacy
 *  integration test suites running without wrapping every `it()` in
 *  `runWithTenant`. The cross-tenant property test explicitly uses
 *  `runWithTenant(...)` so it does NOT rely on the default. Outside test
 *  mode, the function fails closed as documented. */
export function requireOwnerId(): string {
  const ownerId = currentOwnerId();
  if (ownerId) return ownerId;
  if (process.env.VITEST === 'true') return 'owner_home_farm';
  throw new TenantContextMissingError();
}

export class TenantContextMissingError extends Error {
  constructor() {
    super(
      'no tenant context bound — wrap server code in `runWithTenant(ownerId, fn)` before calling repos'
    );
    this.name = 'TenantContextMissingError';
  }
}

// ─── Scoped query primitives (read) ─────────────────────────────────────

/** Returns `eq(table.ownerId, requireOwnerId())`. Pass this into a
 *  Drizzle `.where(...)` chain. Use `withTenant(table, ...extraConditions)`
 *  when other conditions need to combine. */
export function tenantWhere<T extends TenantScopedTable>(table: T): SQL {
  return eq(table.ownerId, requireOwnerId());
}

/** `and(tenantWhere(table), ...extraConditions)`. Drops `undefined` entries
 *  so callers can build conditions conditionally. Returns just the tenant
 *  clause if no extras are provided. */
export function withTenant<T extends TenantScopedTable>(
  table: T,
  ...extraConditions: Array<SQL | undefined>
): SQL {
  const filtered = extraConditions.filter((c): c is SQL => c !== undefined);
  if (filtered.length === 0) return tenantWhere(table);
  const composed = and(tenantWhere(table), ...filtered);
  if (!composed) throw new Error('withTenant: failed to compose conditions');
  return composed;
}

// ─── Scoped query primitives (write) ────────────────────────────────────

/** Stamps `ownerId: requireOwnerId()` into an insert payload. Throws on
 *  caller attempts to write a different ownerId — defensive, in case
 *  user-controlled data ever reaches this helper. */
export function tenantValues<T extends Record<string, unknown>>(
  values: T
): T & { ownerId: string } {
  const ownerId = requireOwnerId();
  if ('ownerId' in values && values.ownerId !== undefined && values.ownerId !== ownerId) {
    throw new Error(
      `tenantValues: payload's ownerId (${String(values.ownerId)}) does not match active tenant (${ownerId})`
    );
  }
  return { ...values, ownerId };
}

// ─── Escape hatches (cross-tenant / global) ─────────────────────────────

/**
 * Read-only marker exported for intentionally-global queries. Call this at
 * the top of any function that touches a tenant-scoped table without
 * applying `tenantWhere` — for example, the login flow looking up which
 * Owner a Helper belongs to, or a superadmin sweep across all tenants.
 *
 * The name is deliberately verbose so reviewers notice. Pair it with a
 * code comment explaining *why* this query is global; reviewers should
 * push back hard if they can't justify the bypass.
 */
export function unscopedQueryNote(reason: string): void {
  if (!reason || reason.length < 8) {
    throw new Error('unscopedQueryNote: provide a meaningful `reason` (>8 chars)');
  }
  // No-op at runtime; the call itself is the documentation.
}
