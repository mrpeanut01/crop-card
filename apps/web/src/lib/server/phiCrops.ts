import type { PluginRegistry } from '$lib/plugins/registry';
import type { PhiCrop } from '$lib/safety/preHarvestInterval';

/** The crop and family a crop plugin id stands for, for the PHI rule (#661). */
export function phiCropOf(registry: PluginRegistry, cropPluginId: string): PhiCrop {
  const plugin = registry.get(cropPluginId)?.plugin as
    { type?: string; cropFamily?: string } | undefined;
  return {
    cropPluginId,
    family: plugin?.type === 'crop' ? (plugin.cropFamily ?? null) : null
  };
}

/** Every crop a spray on a block may reach: each planting on it plus the
 *  named planting's crop, without repeats. */
export function phiCropsFor(
  registry: PluginRegistry,
  cropPluginIds: ReadonlyArray<string | null | undefined>
): PhiCrop[] {
  const ids = new Set(cropPluginIds.filter((id): id is string => !!id));
  return [...ids].map((id) => phiCropOf(registry, id));
}
