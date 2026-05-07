import type { PageServerLoad } from './$types';
import { listBlocks } from '$lib/db/blocks';
import { getCrop } from '$lib/db/crops';
import {
  fertilityBudgetForBlock,
  listFertilityApplicationsForBlock,
  listFertilityCreditsForBlock,
  listSoilTestsForBlock
} from '$lib/db/fertility';

export const load: PageServerLoad = ({ url }) => {
  const blocks = listBlocks();
  const cropId = url.searchParams.get('crop');
  const crop = cropId ? getCrop(cropId) : undefined;
  const blockId = crop?.blockId ?? url.searchParams.get('block') ?? blocks[0]?.id ?? '';
  const year = Number(url.searchParams.get('year')) || new Date().getFullYear();

  return {
    selectedCropId: crop?.id ?? null,
    blocks: blocks.map((b) => ({
      id: b.id,
      name: b.name,
      acres: b.acres ?? null,
      plantings: b.plantings.map((p) => ({
        cropPluginId: p.cropPluginId,
        varietyDisplayName: p.varietyDisplayName
      }))
    })),
    selectedBlockId: blockId,
    year,
    budget: blockId ? fertilityBudgetForBlock(blockId, year) : null,
    applications: blockId ? listFertilityApplicationsForBlock(blockId) : [],
    credits: blockId ? listFertilityCreditsForBlock(blockId) : [],
    soilTests: blockId ? listSoilTestsForBlock(blockId) : []
  };
};
