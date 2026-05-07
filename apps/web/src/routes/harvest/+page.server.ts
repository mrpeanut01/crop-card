import type { PageServerLoad } from './$types';
import { listBlocks } from '$lib/db/blocks';
import { listHarvestEvents } from '$lib/db/harvestEvents';
import type { CropPlugin } from '$lib/plugins/schemas';
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
  plantingDate: number;
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
  const focusPlantingId = url.searchParams.get('planting') ?? null;
  const blocks = listBlocks();
  const registry = await getRegistry();
  const all = listHarvestEvents();
  const harvestedKey = (blockId: string, cropPluginId: string) =>
    `${blockId}|${cropPluginId}`;
  const harvestedSet = new Set(
    all.map((e) => harvestedKey(e.blockId, e.cropPluginId))
  );

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

      if (dtm) {
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

  return {
    plantings,
    recordedHarvests: all,
    focusPlantingId
  };
};
