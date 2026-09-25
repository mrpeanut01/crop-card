import type { BlockWithPlantings } from '$lib/db/blocks';
import { blockDistanceFt } from '$lib/blocks/distance';
import type { CropPlugin } from '$lib/plugins/schemas';
import { isInBloom } from '$lib/safety/pollinatorBloom';
import type { NeighborBlock } from '$lib/pollinator/nearbyBlocks';

/**
 * Other blocks' planted crops, with bloom + bee-attractive flags from their
 * crop plugins and the centroid distance to `treatedBlockId`. `blocks` must
 * come from the tenant-scoped `listBlocks()`.
 */
export function pollinatorNeighbors(
  treatedBlockId: string,
  blocks: BlockWithPlantings[],
  cropPlugin: (pluginId: string) => CropPlugin | null,
  at: number
): NeighborBlock[] {
  const treated = blocks.find((b) => b.id === treatedBlockId);
  if (!treated) return [];
  const out: NeighborBlock[] = [];
  for (const b of blocks) {
    if (b.id === treatedBlockId) continue;
    const crops = b.plantings
      .filter((p): p is typeof p & { plantingDate: number } => p.plantingDate != null)
      .filter((p) => p.plantingDate <= at)
      .map((p) => {
        const plugin = cropPlugin(p.cropPluginId);
        const bloomWindow = plugin?.bloomWindow;
        return {
          cropPluginId: p.cropPluginId,
          displayName: plugin?.displayName ?? p.varietyDisplayName,
          inBloomNow: isInBloom(
            { cropPluginId: p.cropPluginId, plantedAt: p.plantingDate, bloomWindow },
            at
          ),
          beeAttractive: bloomWindow?.beeAttractive === true
        };
      });
    if (crops.length === 0) continue;
    out.push({
      blockId: b.id,
      name: b.blockLabel ?? b.name,
      distanceFt: blockDistanceFt(treated, b),
      crops
    });
  }
  return out;
}
