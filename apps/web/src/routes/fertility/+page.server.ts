import type { PageServerLoad } from './$types';
import { prefsFor } from '$lib/db/userProfile';
import { todayYmd } from '$lib/prefs';
import { listBlocks } from '$lib/db/blocks';
import { getCrop } from '$lib/db/crops';
import { canSetUp } from '$lib/server/setupContext';
import { organicBlocksForNotice } from '$lib/server/organicNotice';
import { getRegistry } from '$lib/server/registry';
import type { OrganicComplianceFlags } from '$lib/organic/inputCompliance';

export interface FertilizerMark {
  displayName: string;
  complianceFlags?: OrganicComplianceFlags;
}

/** B-21: fertility sources resolve as a fertilizer plugin id. Sent only
 *  when the notice can show. */
async function fertilizerMarks(): Promise<Record<string, FertilizerMark>> {
  const out: Record<string, FertilizerMark> = {};
  for (const r of (await getRegistry()).all()) {
    if (r.plugin.type !== 'fertilizer') continue;
    out[r.plugin.pluginId] = {
      displayName: r.plugin.displayName,
      complianceFlags: r.plugin.complianceFlags
    };
  }
  return out;
}
import {
  fertilityBudgetForBlock,
  listFertilityApplicationsForBlock,
  listFertilityCreditsForBlock,
  listSoilTestsForBlock
} from '$lib/db/fertility';

export const load: PageServerLoad = async ({ url, locals }) => {
  const blocks = listBlocks();
  const cropId = url.searchParams.get('crop');
  const crop = cropId ? getCrop(cropId) : undefined;
  const blockId = crop?.blockId ?? url.searchParams.get('block') ?? blocks[0]?.id ?? '';
  const year =
    Number(url.searchParams.get('year')) || Number(todayYmd(prefsFor(locals.user?.id)).slice(0, 4));

  const organicBlocks = organicBlocksForNotice(blocks.map((b) => b.id));
  const hasOrganicBlock = !!organicBlocks && Object.keys(organicBlocks).length > 0;

  return {
    organicBlocks,
    fertilizerMarks: hasOrganicBlock ? await fertilizerMarks() : {},
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
    soilTests: blockId ? listSoilTestsForBlock(blockId) : [],
    canAddSoilTest: canSetUp(locals.user?.role)
  };
};
