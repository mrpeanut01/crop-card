import { listBlocks, type BlockWithPlantings } from '$lib/db/blocks';
import { listCrops } from '$lib/db/crops';
import { listFields } from '$lib/db/fields';
import type { PlanInput, SeedRequest } from '$lib/layout/engine';
import { blockCapacity, sharedBedBlockIds } from '$lib/layout/bedSharing';
import type { CompanionPlugin, CropPlugin } from '$lib/plugins/schemas';
import { companionIndex } from '$lib/plugins/companionRelations';
import type { PluginRegistry } from '$lib/plugins/registry';
import type { SeedSelection } from '$lib/plan/allocationApi';

export type AllocationInputResult =
  | { ok: true; planInput: PlanInput; companionSystems: CompanionPlugin[] }
  | { ok: false; status: 400; body: Record<string, unknown> };

/** A fill-to-bed seed is capped at everything the selected blocks could
 *  hold of it; the engine and the AI then give it a share. */
export function fillCap(
  plugin: CropPlugin,
  blocks: ReadonlyArray<BlockWithPlantings>,
  bedIds: ReadonlySet<string>
): number {
  let total = 0;
  for (const b of blocks) total += blockCapacity(b, plugin, bedIds.has(b.id));
  return Math.max(1, Math.min(1_000_000, total));
}

/** Builds the allocate / refine `PlanInput` from the wizard's selections:
 *  the chosen blocks (tenant-scoped reads), which of them are shared garden
 *  or greenhouse beds (#440), and a size cap for fill-to-bed seeds (#471). */
export function buildAllocationInput(
  registry: PluginRegistry,
  seedSelections: ReadonlyArray<SeedSelection>,
  blockIds: ReadonlyArray<string>
): AllocationInputResult {
  const selectedBlocks = listBlocks().filter((b) => blockIds.includes(b.id));
  if (selectedBlocks.length === 0) {
    return {
      ok: false,
      status: 400,
      body: { error: 'none of the supplied blockIds match a known block' }
    };
  }

  const pluginIndex: Record<string, CropPlugin> = {};
  const companionSystems: CompanionPlugin[] = [];
  for (const r of registry.all()) {
    if (r.plugin.type === 'crop') pluginIndex[r.plugin.pluginId] = r.plugin as CropPlugin;
    else if (r.plugin.type === 'companion') companionSystems.push(r.plugin as CompanionPlugin);
  }

  const unknownPlugins = seedSelections
    .filter((s) => !pluginIndex[s.cropPluginId])
    .map((s) => s.cropPluginId);
  if (unknownPlugins.length > 0) {
    return {
      ok: false,
      status: 400,
      body: { error: 'unknown crop plugin(s)', plugins: unknownPlugins }
    };
  }

  const bedIds = new Set(sharedBedBlockIds(selectedBlocks, listFields()));
  const seeds: SeedRequest[] = seedSelections.map((s) => {
    const fill = s.fillToBed === true;
    return {
      stockItemId: s.stockItemId,
      cropPluginId: s.cropPluginId,
      varietyDisplayName: s.varietyDisplayName,
      quantityPlants: fill
        ? fillCap(pluginIndex[s.cropPluginId], selectedBlocks, bedIds)
        : (s.quantityPlants as number),
      sunRequirement: s.sunRequirement,
      ...(fill ? { fillToCapacity: true } : {}),
      ...(s.keepInOneBed === true ? { keepInOneBed: true } : {})
    };
  });

  return {
    ok: true,
    companionSystems,
    planInput: {
      seeds,
      blocks: selectedBlocks,
      axes: selectedBlocks.map((b) => ({
        blockId: b.id,
        east: b.eastWestIndex ?? null,
        north: b.northSouthIndex ?? null
      })),
      existingCrops: listCrops(),
      pluginIndex,
      companions: companionIndex(companionSystems),
      bedBlockIds: [...bedIds]
    }
  };
}
