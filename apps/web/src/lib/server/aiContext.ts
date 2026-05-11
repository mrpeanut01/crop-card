/**
 * Build the FarmContext that the AI planner takes as its prompt-cached
 * system block. Pure read-side helpers; no model calls here.
 *
 * Phase 17 (Track 3.1) — `buildFarmContext` is now a thin wrapper around
 * an in-process LRU cache keyed on a content-addressed version hash. Any
 * AI endpoint that builds the same context (same blocks, same crop
 * registry, same frost dates) gets a cache hit, eliminating the bytewise
 * recomputation that previously cost a fresh Anthropic prompt-cache miss
 * on every endpoint transition.
 */

import { listBlocks } from '$lib/db/blocks';
import { frostDatesForYear, getFarmLatLon } from '$lib/schedule/settings';
import { resolveCastsShade } from '$lib/plugins/familyDefaults';
import type { CropPlugin } from '$lib/plugins/schemas';
import { getRegistry } from './registry';
import type { FarmContext } from './aiPlanning';
import {
  computeContextVersion,
  getCachedFarmContext,
  setCachedFarmContext
} from './aiContextCache';

export interface BuildFarmContextResult {
  context: FarmContext;
  /** Stable content-hash of the context. AI endpoints can pass this to
   *  the derived-signal store (Track 3.3) and telemetry (Track 3.5) so
   *  every signal computed from this exact context shares an invalidation
   *  key. */
  contextVersion: string;
  /** True when the cache served this build; false when it was rebuilt. */
  cacheHit: boolean;
}

/**
 * Build (or return cached) FarmContext. Year defaults to current year so
 * a `suggest → optimize → allocate → groups` sequence within the same
 * planning session always hits.
 */
export async function buildFarmContextWithCache(
  year: number = new Date().getFullYear()
): Promise<BuildFarmContextResult> {
  const fresh = await assembleFreshContext(year);
  const contextVersion = computeContextVersion(fresh);
  const cached = getCachedFarmContext(contextVersion);
  if (cached) {
    return { context: cached.context, contextVersion, cacheHit: true };
  }
  setCachedFarmContext(contextVersion, fresh);
  return { context: fresh, contextVersion, cacheHit: false };
}

/**
 * Back-compat shim: existing endpoints that call `buildFarmContext()` and
 * don't yet consume `contextVersion` keep working unchanged.
 */
export async function buildFarmContext(
  year: number = new Date().getFullYear()
): Promise<FarmContext> {
  const result = await buildFarmContextWithCache(year);
  return result.context;
}

async function assembleFreshContext(year: number): Promise<FarmContext> {
  const blocks = listBlocks();
  const registry = await getRegistry();
  const cropPlugins = registry.all().filter((r) => r.plugin.type === 'crop');
  const { lastSpringFrostMs, firstFallFrostMs } = frostDatesForYear(year);

  return {
    latLon: getFarmLatLon(),
    lastFrostMs: lastSpringFrostMs,
    firstFrostMs: firstFallFrostMs,
    blocks: blocks.map((b) => ({
      id: b.id,
      label: b.blockLabel ?? b.name,
      eastWestIndex: b.eastWestIndex ?? null,
      northSouthIndex: b.northSouthIndex ?? null,
      acres: b.acres ?? null,
      sunExposure: b.sunExposure ?? null
    })),
    cropCatalog: cropPlugins.map((r) => {
      const p = r.plugin as CropPlugin;
      return {
        pluginId: p.pluginId,
        family: p.cropFamily,
        dtmMin: p.daysToMaturity?.min ?? null,
        dtmMax: p.daysToMaturity?.max ?? null,
        // Track 1, B7 — delegate to the resolver so the AI context sees
        // the same shade-casting logic the calendar engine uses.
        shadeCasting: resolveCastsShade(p),
        matureHeightFt: p.matureHeightFt
      };
    })
  };
}
