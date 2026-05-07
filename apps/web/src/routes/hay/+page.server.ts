import type { PageServerLoad } from './$types';
import { listBlocks } from '$lib/db/blocks';
import { getCrop } from '$lib/db/crops';
import { listCuttings } from '$lib/db/hayCuttings';
import { getRegistry } from '$lib/server/registry';

export const load: PageServerLoad = async ({ url }) => {
  const registry = await getRegistry();
  const blocks = listBlocks();
  const cropId = url.searchParams.get('crop');
  const crop = cropId ? getCrop(cropId) : undefined;
  const hayCrops = registry
    .crops()
    .filter((c) => c.hayOperations !== undefined)
    .map((c) => ({
      pluginId: c.pluginId,
      displayName: c.displayName,
      cropFamily: c.cropFamily,
      hayOperations: c.hayOperations
    }));

  const blockOptions = blocks.map((b) => {
    const hayPlanting = b.plantings.find((p) =>
      hayCrops.some((h) => h.pluginId === p.cropPluginId)
    );
    return {
      id: b.id,
      name: b.name,
      acres: b.acres ?? null,
      hasGeometry: !!b.geometryGeojson,
      hayPlanting: hayPlanting
        ? {
            cropPluginId: hayPlanting.cropPluginId,
            varietyDisplayName: hayPlanting.varietyDisplayName
          }
        : null
    };
  });

  const selectedBlockId =
    crop?.blockId ??
    url.searchParams.get('block') ??
    blockOptions.find((b) => b.hayPlanting)?.id ??
    blockOptions[0]?.id ??
    '';
  const year = Number(url.searchParams.get('year')) || new Date().getFullYear();

  return {
    blocks: blockOptions,
    hayCrops,
    selectedBlockId,
    selectedCropId: crop?.id ?? null,
    year,
    cuttings: selectedBlockId ? listCuttings({ blockId: selectedBlockId, year }) : []
  };
};
