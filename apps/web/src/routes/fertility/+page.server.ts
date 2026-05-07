import type { PageServerLoad } from './$types';
import { listBlocks } from '$lib/db/blocks';
import {
  fertilityBudgetForBlock,
  listFertilityApplicationsForBlock,
  listFertilityCreditsForBlock,
  listSoilTestsForBlock
} from '$lib/db/fertility';

export const load: PageServerLoad = ({ url }) => {
  const blocks = listBlocks();
  const blockId = url.searchParams.get('block') ?? blocks[0]?.id ?? '';
  const year = Number(url.searchParams.get('year')) || new Date().getFullYear();

  return {
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
