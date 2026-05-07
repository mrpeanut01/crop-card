import type { PageServerLoad } from './$types';
import { listBlocks } from '$lib/db/blocks';

export const load: PageServerLoad = () => {
  const blocks = listBlocks();
  return {
    blocks: blocks.map((b) => ({
      id: b.id,
      name: b.name,
      acres: b.acres ?? null,
      blockLabel: b.blockLabel ?? null,
      geometryGeojson: b.geometryGeojson ?? null,
      plantingsCount: b.plantings.length
    }))
  };
};
