import type { PageServerLoad } from './$types';
import { listBlocks } from '$lib/db/blocks';
import { getCrop } from '$lib/db/crops';

export const load: PageServerLoad = ({ url }) => {
  const cropId = url.searchParams.get('crop');
  let preselectedBlockId = url.searchParams.get('block');
  if (cropId && !preselectedBlockId) {
    const c = getCrop(cropId);
    if (c) preselectedBlockId = c.blockId;
  }
  return {
    blocks: listBlocks().map((b) => ({
      id: b.id,
      name: b.name,
      cropPluginIds: b.plantings.map((p) => p.cropPluginId)
    })),
    preselectedBlockId,
    preselectedCropId: cropId,
    windowStage: url.searchParams.get('windowStage') ?? null
  };
};
