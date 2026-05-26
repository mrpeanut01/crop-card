import type { PageServerLoad } from './$types';
import { listBlocks } from '$lib/db/blocks';
import { listHarvestEvents } from '$lib/db/harvestEvents';
import type { Archetype, CropPlugin, HarvestStyle } from '$lib/plugins/schemas';
import { getRegistry } from '$lib/server/registry';

const DAY_MS = 24 * 60 * 60 * 1000;

export type HarvestStatus = 'too-early' | 'in-window' | 'past' | 'unknown';

export interface PlantingHarvestStatus {
  blockId: string;
  blockName: string;
  plantingId: string;
  cropPluginId: string;
  varietyDisplayName: string;
  cropFamily?: string;
  /** Phase 25c.0 #87 — legacy discriminator. Phase 27A prefers
   *  `archetype` (plugin-declared) + `archetypeOverride` (planting-level);
   *  HarvestRouter resolves through `resolveArchetype()` when archetype
   *  is absent. */
  harvestStyle?: HarvestStyle;
  /** Phase 27A — explicit plugin archetype. */
  archetype?: Archetype;
  /** Phase 27A — per-planting operator override (migration 0039). */
  archetypeOverride?: Archetype | null;
  plantingDate: number | null;
  windowStartMs?: number;
  windowEndMs?: number;
  status: HarvestStatus;
  daysUntilWindow?: number;
  daysIntoWindow?: number;
  daysPastWindow?: number;
  harvestIndicators: string[];
  alreadyHarvested: boolean;
}

export const load: PageServerLoad = async ({ url }) => {
  // ?crop=<id> aliases ?planting=<id> for Phase 12D crop-attribution
  // navigation. Both fall through to the planting-status loop below.
  const focusPlantingId = url.searchParams.get('crop') ?? url.searchParams.get('planting') ?? null;
  const blocks = listBlocks();
  const registry = await getRegistry();
  const all = listHarvestEvents();
  const harvestedKey = (blockId: string, cropPluginId: string) => `${blockId}|${cropPluginId}`;
  const harvestedSet = new Set(all.map((e) => harvestedKey(e.blockId, e.cropPluginId)));

  const now = Date.now();
  const plantings: PlantingHarvestStatus[] = [];

  for (const b of blocks) {
    for (const p of b.plantings) {
      const rec = registry.get(p.cropPluginId);
      const crop = rec?.plugin.type === 'crop' ? (rec.plugin as CropPlugin) : undefined;
      const dtm = crop?.daysToMaturity;
      let status: HarvestStatus = 'unknown';
      let windowStartMs: number | undefined;
      let windowEndMs: number | undefined;
      let daysUntilWindow: number | undefined;
      let daysIntoWindow: number | undefined;
      let daysPastWindow: number | undefined;

      if (dtm && p.plantingDate !== null) {
        windowStartMs = p.plantingDate + dtm.min * DAY_MS;
        windowEndMs = p.plantingDate + dtm.max * DAY_MS;
        if (now < windowStartMs) {
          status = 'too-early';
          daysUntilWindow = Math.ceil((windowStartMs - now) / DAY_MS);
        } else if (now <= windowEndMs) {
          status = 'in-window';
          daysIntoWindow = Math.floor((now - windowStartMs) / DAY_MS);
        } else {
          status = 'past';
          daysPastWindow = Math.floor((now - windowEndMs) / DAY_MS);
        }
      }

      plantings.push({
        blockId: b.id,
        blockName: b.name,
        plantingId: p.id,
        cropPluginId: p.cropPluginId,
        varietyDisplayName: p.varietyDisplayName,
        cropFamily: crop?.cropFamily,
        harvestStyle: crop?.harvestStyle,
        archetype: crop?.archetype,
        archetypeOverride: (p as { archetypeOverride?: Archetype | null }).archetypeOverride ?? null,
        plantingDate: p.plantingDate,
        windowStartMs,
        windowEndMs,
        status,
        daysUntilWindow,
        daysIntoWindow,
        daysPastWindow,
        harvestIndicators: crop?.harvestIndicators ?? [],
        alreadyHarvested: harvestedSet.has(harvestedKey(b.id, p.cropPluginId))
      });
    }
  }

  plantings.sort((a, b) => {
    const order: Record<HarvestStatus, number> = {
      'in-window': 0,
      past: 1,
      'too-early': 2,
      unknown: 3
    };
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return (a.windowStartMs ?? Infinity) - (b.windowStartMs ?? Infinity);
  });

  // FR-08: enrich each recorded harvest with curing-status from the crop
  // plugin's postHarvestCuring data so the operator sees countdown to ready.
  const blockNameById = new Map(blocks.map((b) => [b.id, b.name]));
  const recordedHarvests = all.map((h) => {
    const rec = registry.get(h.cropPluginId);
    const crop = rec?.plugin.type === 'crop' ? (rec.plugin as CropPlugin) : undefined;
    const curing = crop?.postHarvestCuring;
    const blockName = blockNameById.get(h.blockId) ?? null;
    if (!curing) {
      return { ...h, blockName, curing: null };
    }
    const minMs = h.occurredAt + curing.durationWeeks.min * 7 * DAY_MS;
    const maxMs = h.occurredAt + curing.durationWeeks.max * 7 * DAY_MS;
    let phase: 'in-progress' | 'ready' | 'overdue';
    let daysRemaining = 0;
    if (now < minMs) {
      phase = 'in-progress';
      daysRemaining = Math.ceil((minMs - now) / DAY_MS);
    } else if (now <= maxMs) {
      phase = 'ready';
      daysRemaining = Math.ceil((maxMs - now) / DAY_MS);
    } else {
      phase = 'overdue';
      daysRemaining = Math.floor((now - maxMs) / DAY_MS);
    }
    return {
      ...h,
      blockName,
      curing: {
        method: curing.method,
        minWeeks: curing.durationWeeks.min,
        maxWeeks: curing.durationWeeks.max,
        targetMoisturePercent: curing.targetMoisturePercent,
        storageLocation: curing.storageLocation,
        readyMs: minMs,
        overdueMs: maxMs,
        phase,
        daysRemaining
      }
    };
  });

  return {
    plantings,
    recordedHarvests,
    focusPlantingId
  };
};
