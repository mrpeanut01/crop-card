/**
 * Plugin version history repo (Phase 22).
 *
 * Append-only catalog of every plugin payload that has been written. The
 * on-disk JSON under `plugins/{kind}s/{pluginId}.json` always reflects the
 * latest non-superseded, non-retired row.
 *
 * GLOBAL table by design — plugins are a single catalog (CLAUDE.md
 * invariant #2). The per-tenant customization layer lives in
 * `plugin_overrides`. B-31 (marketplace) will introduce per-owner installed
 * state when the catalog ceases to be global.
 *
 * Replay safety: `getPluginByHash(pluginId, hash)` resolves an
 * event-row's `pluginHashesJson` to the exact JSON in force at the time of
 * the application, even if the live plugin has been edited or retired.
 */

import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { db } from './client';
import { pluginVersions } from './schema';
import { unscopedQueryNote } from './tenant';
import type { PluginDiff } from '$lib/plugins/diff';

export type PluginKind =
  | 'crop'
  | 'herbicide'
  | 'insecticide'
  | 'fungicide'
  | 'fertilizer'
  | 'companion';

export interface PluginVersionRow {
  id: string;
  pluginId: string;
  version: string;
  kind: PluginKind;
  hash: string;
  payloadJson: string;
  changedByUserId?: string;
  changeReason?: string;
  diffSummary?: PluginDiff;
  createdAt: number;
  supersededAt?: number;
  retiredAt?: number;
}

function rowToVersion(row: typeof pluginVersions.$inferSelect): PluginVersionRow {
  return {
    id: row.id,
    pluginId: row.pluginId,
    version: row.version,
    kind: row.kind,
    hash: row.hash,
    payloadJson: row.payloadJson,
    changedByUserId: row.changedByUserId ?? undefined,
    changeReason: row.changeReason ?? undefined,
    diffSummary: row.diffSummaryJson ? (JSON.parse(row.diffSummaryJson) as PluginDiff) : undefined,
    createdAt: row.createdAt.getTime(),
    supersededAt: row.supersededAt?.getTime(),
    retiredAt: row.retiredAt?.getTime()
  };
}

/** Current (non-superseded) row for a plugin, or undefined if no history. */
export function currentVersionOf(pluginId: string): PluginVersionRow | undefined {
  unscopedQueryNote('plugin catalog is global by design');
  const row = db
    .select()
    .from(pluginVersions)
    .where(and(eq(pluginVersions.pluginId, pluginId), isNull(pluginVersions.supersededAt)))
    .get();
  return row ? rowToVersion(row) : undefined;
}

/** Full version history for a plugin, newest first. */
export function historyOf(pluginId: string): PluginVersionRow[] {
  unscopedQueryNote('plugin catalog is global by design');
  return db
    .select()
    .from(pluginVersions)
    .where(eq(pluginVersions.pluginId, pluginId))
    .orderBy(desc(pluginVersions.createdAt))
    .all()
    .map(rowToVersion);
}

/** Resolve `event.pluginHashesJson[pluginId]` to the exact payload that
 *  was current when the event was recorded. */
export function getByHash(pluginId: string, hash: string): PluginVersionRow | undefined {
  unscopedQueryNote('plugin catalog is global by design');
  const row = db
    .select()
    .from(pluginVersions)
    .where(and(eq(pluginVersions.pluginId, pluginId), eq(pluginVersions.hash, hash)))
    .get();
  return row ? rowToVersion(row) : undefined;
}

/** Snapshot of every plugin's current row — drives the list view. */
export function listAllCurrent(): PluginVersionRow[] {
  unscopedQueryNote('plugin catalog is global by design');
  return db
    .select()
    .from(pluginVersions)
    .where(isNull(pluginVersions.supersededAt))
    .orderBy(asc(pluginVersions.pluginId))
    .all()
    .map(rowToVersion);
}

export interface InsertVersionInput {
  pluginId: string;
  version: string;
  kind: PluginKind;
  hash: string;
  payloadJson: string;
  changedByUserId?: string;
  changeReason?: string;
  diffSummary?: PluginDiff;
}

/** Append a new version row and mark the prior current row as superseded.
 *  Idempotent on (pluginId, hash) — re-writing the same payload is a no-op
 *  and returns the existing row. */
export function appendVersion(input: InsertVersionInput): PluginVersionRow {
  unscopedQueryNote('plugin catalog is global by design');
  const existing = getByHash(input.pluginId, input.hash);
  if (existing && !existing.supersededAt) return existing;

  return db.transaction((tx) => {
    tx.update(pluginVersions)
      .set({ supersededAt: new Date(Date.now()) })
      .where(and(eq(pluginVersions.pluginId, input.pluginId), isNull(pluginVersions.supersededAt)))
      .run();

    const row = tx
      .insert(pluginVersions)
      .values({
        id: randomUUID(),
        pluginId: input.pluginId,
        version: input.version,
        kind: input.kind,
        hash: input.hash,
        payloadJson: input.payloadJson,
        changedByUserId: input.changedByUserId ?? null,
        changeReason: input.changeReason ?? null,
        diffSummaryJson: input.diffSummary ? JSON.stringify(input.diffSummary) : null
      })
      .returning()
      .get();
    return rowToVersion(row);
  });
}

/** Mark the current row retired. Reversible via `unretire`. */
export function retire(pluginId: string): boolean {
  unscopedQueryNote('plugin catalog is global by design');
  const r = db
    .update(pluginVersions)
    .set({ retiredAt: new Date(Date.now()) })
    .where(and(eq(pluginVersions.pluginId, pluginId), isNull(pluginVersions.supersededAt)))
    .run();
  return r.changes > 0;
}

export function unretire(pluginId: string): boolean {
  unscopedQueryNote('plugin catalog is global by design');
  const r = db
    .update(pluginVersions)
    .set({ retiredAt: null })
    .where(and(eq(pluginVersions.pluginId, pluginId), isNull(pluginVersions.supersededAt)))
    .run();
  return r.changes > 0;
}

/** Delete a single version row by id. Server-only — used by the rescan
 *  cleanup pass to collapse adjacent Zod-canonically-equal rows that the
 *  initial table seed produced before canonicalization was hardened. */
export function deleteVersion(id: string): boolean {
  unscopedQueryNote('plugin catalog is global by design');
  const r = db.delete(pluginVersions).where(eq(pluginVersions.id, id)).run();
  return r.changes > 0;
}

/** Override the supersededAt timestamp on a specific row by id. Paired
 *  with deleteVersion in the collapse pass: when a newer duplicate row
 *  is deleted, the older row inherits whatever supersededAt the newer
 *  had (null if it was still current) so the current-row pointer stays
 *  consistent. Pass `null` to clear (mark the row current again). */
export function setSupersededAt(id: string, supersededAt: number | null): boolean {
  unscopedQueryNote('plugin catalog is global by design');
  const value = supersededAt === null ? null : new Date(supersededAt);
  const r = db
    .update(pluginVersions)
    .set({ supersededAt: value })
    .where(eq(pluginVersions.id, id))
    .run();
  return r.changes > 0;
}

/** Bump the patch segment of a semver string. Treats malformed input as
 *  `1.0.0` so a hand-edited plugin without a proper version still gets a
 *  monotonic forward-bump. */
export function bumpPatch(version: string): string {
  const parts = version.split('.').map((s) => parseInt(s, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
    return '1.0.0';
  }
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}

/** True when `candidate` is strictly greater than `current` under
 *  three-segment numeric semver. Used by the upload endpoint to enforce
 *  monotonic forward-only versions. */
export function isVersionAhead(candidate: string, current: string): boolean {
  const a = candidate.split('.').map((s) => parseInt(s, 10));
  const b = current.split('.').map((s) => parseInt(s, 10));
  for (let i = 0; i < 3; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return false;
}
