/**
 * Phase 17 (Track 3.1) — request-batch cache for the AI farm context.
 *
 * Each AI endpoint (`suggest`, `optimize`, `allocate`, `groups`) calls
 * `buildFarmContext()` to assemble blocks + crop catalog + frost dates +
 * lat-lon. Without caching, a user moving from `suggest` → `allocate` →
 * `groups` rebuilds the same ~5–15 kB context 3–4 times in a few minutes,
 * paying a full Anthropic prompt-cache miss on every transition because
 * the system block bytes are reconstructed (different `String` identity
 * even when content is identical).
 *
 * This module provides:
 *  - In-process LRU keyed on a content hash (SHA-256 of the assembled
 *    JSON). Identical inputs across endpoints → identical key → re-use.
 *  - 10-minute TTL matching Anthropic's ephemeral prompt-cache window.
 *  - A `getOrBuildFarmContext()` accessor `aiContext.ts` wraps so all
 *    endpoints transparently benefit.
 *  - Telemetry hooks for cache hit/miss accounting (Track 3.5 consumes).
 *
 * Not persistent across process restarts — that's intentional. Anthropic's
 * cache is also ephemeral, so an in-memory layer suffices and avoids
 * sync-with-DB invalidation complexity.
 */

import { createHash } from 'node:crypto';
import type { FarmContext } from './aiPlanning';

const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 8;

interface CacheEntry {
  contextVersion: string;
  context: FarmContext;
  prebuiltSystemPrompt: string | null;
  cachedAt: number;
  hits: number;
}

const cache = new Map<string, CacheEntry>();
const stats = {
  hits: 0,
  misses: 0,
  invalidations: 0
};

/**
 * Compute a content-addressed version hash from the bits that change a
 * farm context's bytes. Two distinct inputs that hash to the same value
 * MUST produce identical FarmContext objects, modulo serialization order.
 */
export function computeContextVersion(input: FarmContext): string {
  const canonical = JSON.stringify({
    latLon: input.latLon,
    lastFrostMs: input.lastFrostMs,
    firstFrostMs: input.firstFrostMs,
    blocks: [...input.blocks].sort((a, b) => a.id.localeCompare(b.id)),
    cropCatalog: [...input.cropCatalog].sort((a, b) => a.pluginId.localeCompare(b.pluginId))
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

/**
 * Look up by version. Returns null on miss or expired entry.
 */
export function getCachedFarmContext(contextVersion: string): CacheEntry | null {
  const entry = cache.get(contextVersion);
  if (!entry) {
    stats.misses++;
    return null;
  }
  if (Date.now() - entry.cachedAt > TTL_MS) {
    cache.delete(contextVersion);
    stats.invalidations++;
    stats.misses++;
    return null;
  }
  entry.hits++;
  stats.hits++;
  return entry;
}

/**
 * Insert / update an entry. Caller computes the version (typically via
 * `computeContextVersion`) so the same hash never gets recomputed twice
 * within a request.
 */
export function setCachedFarmContext(
  contextVersion: string,
  context: FarmContext,
  prebuiltSystemPrompt: string | null = null
): CacheEntry {
  const entry: CacheEntry = {
    contextVersion,
    context,
    prebuiltSystemPrompt,
    cachedAt: Date.now(),
    hits: 0
  };
  cache.set(contextVersion, entry);
  evictIfOverLimit();
  return entry;
}

/**
 * Optionally attach a prebuilt system-prompt string to an entry. Lets
 * `aiPlanning.ts` skip the second-pass prompt assembly when the same
 * context is reused.
 */
export function setPrebuiltSystemPrompt(contextVersion: string, prebuilt: string): void {
  const entry = cache.get(contextVersion);
  if (entry) entry.prebuiltSystemPrompt = prebuilt;
}

export function clearAiContextCache(): void {
  cache.clear();
  stats.hits = 0;
  stats.misses = 0;
  stats.invalidations = 0;
}

export function getAiContextCacheStats(): {
  size: number;
  hits: number;
  misses: number;
  invalidations: number;
  hitRatio: number;
  entries: Array<{ version: string; hits: number; ageMs: number }>;
} {
  const total = stats.hits + stats.misses;
  return {
    size: cache.size,
    hits: stats.hits,
    misses: stats.misses,
    invalidations: stats.invalidations,
    hitRatio: total === 0 ? 0 : stats.hits / total,
    entries: Array.from(cache.values()).map((e) => ({
      version: e.contextVersion,
      hits: e.hits,
      ageMs: Date.now() - e.cachedAt
    }))
  };
}

function evictIfOverLimit(): void {
  if (cache.size <= MAX_ENTRIES) return;
  // Evict oldest by `cachedAt`.
  let oldestKey: string | null = null;
  let oldestAt = Infinity;
  for (const [k, v] of cache) {
    if (v.cachedAt < oldestAt) {
      oldestAt = v.cachedAt;
      oldestKey = k;
    }
  }
  if (oldestKey) cache.delete(oldestKey);
}
