/**
 * Server-side helper: hydrate a `PlanInput` for the layout engine from
 * registry + DB. Kept separate from `engine.ts` so the engine itself stays
 * pure and testable.
 */

import { listBlocks, inferBlockAxes } from '$lib/db/blocks';
import { listCrops } from '$lib/db/crops';
import type { CompanionPlugin, CropPlugin } from '$lib/plugins/schemas';
import type { PluginRegistry } from '$lib/plugins/registry';
import { companionIndex } from '$lib/plugins/companionRelations';
import type { PlanInput, SeedRequest } from './engine';

export function buildPlanInput(
  registry: PluginRegistry,
  seeds: ReadonlyArray<SeedRequest>
): PlanInput {
  const blocks = listBlocks();
  const axesMap = inferBlockAxes(blocks);
  const axes = Array.from(axesMap.entries()).map(([blockId, v]) => ({
    blockId,
    east: v.east,
    north: v.north
  }));
  const existingCrops = listCrops({});
  const pluginIndex: Record<string, CropPlugin> = {};
  const companionPlugins: CompanionPlugin[] = [];
  for (const rec of registry.all()) {
    if (rec.plugin.type === 'crop') {
      pluginIndex[rec.plugin.pluginId] = rec.plugin as CropPlugin;
    } else if (rec.plugin.type === 'companion') {
      companionPlugins.push(rec.plugin as CompanionPlugin);
    }
  }
  const companions = companionIndex(companionPlugins);
  return {
    seeds,
    blocks,
    axes,
    existingCrops,
    pluginIndex,
    companions
  };
}
