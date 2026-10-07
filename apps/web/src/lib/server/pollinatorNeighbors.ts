import type { BlockWithPlantings } from '$lib/db/blocks';
import { blockDistanceFt } from '$lib/blocks/distance';
import type { CropPlugin } from '$lib/plugins/schemas';
import { isInBloom } from '$lib/safety/pollinatorBloom';
import type { NeighborBlock } from '$lib/pollinator/nearbyBlocks';
import { plantingStandsForBloom } from './sprayCrops';

/**
 * Other blocks' planted crops, with bloom + bee-attractive flags from their
 * crop plugins and the centroid distance to `treatedBlockId`. Only plantings
 * in the ground at `at` count (#676), and blocks in the treated block's Area
 * are marked `sameArea`. `blocks` must
 * come from the tenant-scoped `listBlocks()`.
 */
export function pollinatorNeighbors(
  treatedBlockId: string,
  blocks: BlockWithPlantings[],
  cropPlugin: (pluginId: string) => CropPlugin | null,
  at: number,
  timeZone?: string
): NeighborBlock[] {
  const treated = blocks.find((b) => b.id === treatedBlockId);
  if (!treated) return [];
  const out: NeighborBlock[] = [];
  for (const b of blocks) {
    if (b.id === treatedBlockId) continue;
    const crops = b.plantings
      .filter((p): p is typeof p & { plantingDate: number } => plantingStandsForBloom(p, at))
      .map((p) => {
        const plugin = cropPlugin(p.cropPluginId);
        const bloomWindow = plugin?.bloomWindow;
        return {
          cropPluginId: p.cropPluginId,
          displayName: plugin?.displayName ?? p.varietyDisplayName,
          inBloomNow: isInBloom(
            { cropPluginId: p.cropPluginId, plantedAt: p.plantingDate, bloomWindow },
            at,
            timeZone
          ),
          beeAttractive: bloomWindow?.beeAttractive === true
        };
      });
    if (crops.length === 0) continue;
    out.push({
      blockId: b.id,
      name: b.blockLabel ?? b.name,
      distanceFt: blockDistanceFt(treated, b),
      ...(treated.fieldId && treated.fieldId === b.fieldId ? { sameArea: true } : {}),
      crops
    });
  }
  return out;
}
