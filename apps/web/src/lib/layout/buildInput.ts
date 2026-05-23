/**
 * Server-side helper: hydrate a `PlanInput` for the layout engine from
 * registry + DB. Kept separate from `engine.ts` so the engine itself stays
 * pure and testable.
 */

import { listBlocks, inferBlockAxes } from '$lib/db/blocks';
import { listCrops } from '$lib/db/crops';
import type { CompanionPlugin, CropPlugin } from '$lib/plugins/schemas';
import type { PluginRegistry } from '$lib/plugins/registry';
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
  const companions: Record<string, { goodWith: string[]; badWith: string[] }> = {};
  for (const rec of registry.all()) {
    if (rec.plugin.type === 'crop') {
      pluginIndex[rec.plugin.pluginId] = rec.plugin as CropPlugin;
    } else if (rec.plugin.type === 'companion') {
      const c = rec.plugin as CompanionPlugin;
      for (const a of c.goodWith ?? []) {
        const entry = (companions[a] ??= { goodWith: [], badWith: [] });
        for (const b of c.goodWith ?? [])
          if (b !== a && !entry.goodWith.includes(b)) entry.goodWith.push(b);
        for (const b of c.badWith ?? []) if (!entry.badWith.includes(b)) entry.badWith.push(b);
      }
      for (const a of c.badWith ?? []) {
        const entry = (companions[a] ??= { goodWith: [], badWith: [] });
        for (const b of c.goodWith ?? []) if (!entry.badWith.includes(b)) entry.badWith.push(b);
      }
    }
  }
  return {
    seeds,
    blocks,
    axes,
    existingCrops,
    pluginIndex,
    companions
  };
}
