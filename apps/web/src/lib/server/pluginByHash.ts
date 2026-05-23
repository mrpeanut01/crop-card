/**
 * Resolve a (pluginId, hash) pair to the exact plugin payload that was in
 * force when an event row was recorded (Phase 22).
 *
 * Event rows persist `pluginHashesJson` at write time. After Phase 22's
 * versioning, the live registry no longer guarantees that the on-disk
 * plugin matches that hash — the operator may have bumped the version,
 * retired the plugin, or rolled it back. This helper reads the historical
 * payload from `plugin_versions` so PDF export, `/records` rendering, and
 * audit replay keep working.
 *
 * Backed by a small in-process LRU. The cache is safe to keep across
 * requests because `plugin_versions` is append-only — once a (pluginId,
 * hash) row exists, its payload never changes.
 */

import { getByHash, type PluginVersionRow } from '$lib/db/pluginVersions';
import type { Plugin } from '$lib/plugins';

const MAX_ENTRIES = 64;
const cache = new Map<string, PluginVersionRow | null>();

function bump(key: string, value: PluginVersionRow | null): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Return the version row for (pluginId, hash) or null when unknown. */
export function getPluginByHash(pluginId: string, hash: string): PluginVersionRow | null {
  const key = `${pluginId}@${hash}`;
  if (cache.has(key)) {
    const cached = cache.get(key) ?? null;
    bump(key, cached);
    return cached;
  }
  const row = getByHash(pluginId, hash) ?? null;
  bump(key, row);
  return row;
}

/** Decode the stored payload back into a typed Plugin. Returns null on
 *  missing row, empty (uninstall tombstone) payload, or parse failure. */
export function getPluginPayloadByHash(pluginId: string, hash: string): Plugin | null {
  const row = getPluginByHash(pluginId, hash);
  if (!row || row.payloadJson === '') return null;
  try {
    return JSON.parse(row.payloadJson) as Plugin;
  } catch {
    return null;
  }
}

/** Test-only — clear the LRU so the same vitest worker doesn't see a
 *  stale row from a previous test. */
export function _resetPluginByHashCache(): void {
  cache.clear();
}
