/**
 * Per-Owner plugin overlay (Phase 18a table, wired in the Invariant 6 sweep).
 *
 * The shared library lives on disk + `plugin_versions` and only a
 * superadmin changes it. An Owner's own changes land here instead:
 *   - an upload / edit / save-to-catalog appends a row with the full
 *     plugin payload; the newest row per pluginId replaces the shared
 *     plugin for that Owner only;
 *   - retire appends a hidden marker (empty payload); unretire deletes the
 *     markers so the newest payload row (or the shared plugin) shows again.
 * Payload rows are never deleted, so event replay by hash keeps working.
 * Every write bumps `owners.plugin_overrides_revision` — the registry keys
 * its per-Owner view on it.
 */

import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from './client';
import { owners, pluginOverrides } from './schema';
import { requireOwnerId, tenantValues, unscopedQueryNote, withTenant } from './tenant';
import type { PluginKind } from './pluginVersions';

export const HIDDEN_PAYLOAD = '';

export interface PluginOverride {
  id: string;
  pluginId: string;
  kind: PluginKind;
  payloadJson: string;
  hash: string;
  createdAt: number;
}

function rowToOverride(row: typeof pluginOverrides.$inferSelect): PluginOverride {
  return {
    id: row.id,
    pluginId: row.pluginId,
    kind: row.kind as PluginKind,
    payloadJson: row.payloadJson,
    hash: row.hash,
    createdAt: row.createdAt.getTime()
  };
}

export function hashOverridePayload(payloadJson: string): string {
  return createHash('sha256').update(payloadJson).digest('hex');
}

function bumpRevision(): void {
  const ownerId = requireOwnerId();
  unscopedQueryNote('owners row carries the per-Owner plugin overlay revision');
  db.update(owners)
    .set({ pluginOverridesRevision: sql`${owners.pluginOverridesRevision} + 1` })
    .where(eq(owners.id, ownerId))
    .run();
}

export function overridesRevision(ownerId: string): number {
  unscopedQueryNote('owners row carries the per-Owner plugin overlay revision');
  const row = db
    .select({ rev: owners.pluginOverridesRevision })
    .from(owners)
    .where(eq(owners.id, ownerId))
    .get();
  return row?.rev ?? 0;
}

/** Newest row per pluginId for the active Owner. */
export function listEffectiveOverrides(): Map<string, PluginOverride> {
  const rows = db
    .select()
    .from(pluginOverrides)
    .where(withTenant(pluginOverrides))
    .orderBy(desc(pluginOverrides.createdAt))
    .all();
  const out = new Map<string, PluginOverride>();
  for (const r of rows) {
    if (!out.has(r.pluginId)) out.set(r.pluginId, rowToOverride(r));
  }
  return out;
}

export function effectiveOverride(pluginId: string): PluginOverride | undefined {
  const row = db
    .select()
    .from(pluginOverrides)
    .where(withTenant(pluginOverrides, eq(pluginOverrides.pluginId, pluginId)))
    .orderBy(desc(pluginOverrides.createdAt))
    .limit(1)
    .get();
  return row ? rowToOverride(row) : undefined;
}

export function isHiddenForOwner(pluginId: string): boolean {
  return effectiveOverride(pluginId)?.payloadJson === HIDDEN_PAYLOAD;
}

function insertRow(pluginId: string, kind: PluginKind, payloadJson: string): PluginOverride {
  const prior = effectiveOverride(pluginId);
  const createdAt = new Date(Math.max(Date.now(), (prior?.createdAt ?? 0) + 1));
  const row = db
    .insert(pluginOverrides)
    .values(
      tenantValues({
        id: randomUUID(),
        pluginId,
        kind,
        payloadJson,
        hash: hashOverridePayload(payloadJson),
        createdAt
      })
    )
    .returning()
    .get();
  bumpRevision();
  return rowToOverride(row);
}

export function insertOverridePayload(
  pluginId: string,
  kind: PluginKind,
  payloadJson: string
): PluginOverride {
  return insertRow(pluginId, kind, payloadJson);
}

export function hideForOwner(pluginId: string, kind: PluginKind): void {
  if (isHiddenForOwner(pluginId)) return;
  insertRow(pluginId, kind, HIDDEN_PAYLOAD);
}

export function unhideForOwner(pluginId: string): void {
  const removed = db
    .delete(pluginOverrides)
    .where(
      withTenant(
        pluginOverrides,
        and(eq(pluginOverrides.pluginId, pluginId), eq(pluginOverrides.payloadJson, HIDDEN_PAYLOAD))
      )
    )
    .run();
  if (removed.changes > 0) bumpRevision();
}

/** Replay lookup: an Owner's own payload row by (pluginId, hash). */
export function getOverrideByHash(pluginId: string, hash: string): PluginOverride | undefined {
  const row = db
    .select()
    .from(pluginOverrides)
    .where(
      withTenant(
        pluginOverrides,
        and(eq(pluginOverrides.pluginId, pluginId), eq(pluginOverrides.hash, hash))
      )
    )
    .get();
  return row && row.payloadJson !== HIDDEN_PAYLOAD ? rowToOverride(row) : undefined;
}
