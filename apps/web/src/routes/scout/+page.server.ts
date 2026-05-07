import type { PageServerLoad } from './$types';
import { listBlocks } from '$lib/db/blocks';

export const load: PageServerLoad = ({ url }) => {
  return {
    blocks: listBlocks().map((b) => ({
      id: b.id,
      name: b.name,
      cropPluginIds: b.plantings.map((p) => p.cropPluginId)
    })),
    preselectedBlockId: url.searchParams.get('block') ?? null,
    windowStage: url.searchParams.get('windowStage') ?? null
  };
};
