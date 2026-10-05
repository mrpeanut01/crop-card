/**
 * The crops a herbicide spray is judged against (FR-03, NFR-07). The
 * kernel runs on the union of what the client says is on the block and
 * what the block's plantings on file say is in the ground at the spray
 * time, never fewer. The registry's crop family always wins over a family
 * the client sends; a client family only stands for a crop the registry
 * does not know. The measured corn height comes from the client and is
 * carried to the corn crop, since the stage gate reads the primary crop.
 */

import type { CropFamily } from '$lib/safety/cropFamilyLethality';
import type { CropStage } from '$lib/safety';

export interface ClientSprayCrop {
  cropPluginId: string;
  cropFamily?: CropFamily;
  heightInches?: number;
  growthStage?: string;
}

export interface SprayCropRegistry {
  cropFamilyOf(cropPluginId: string): CropFamily | undefined;
  cropTraitsOf(cropPluginId: string): readonly string[];
}

export interface BlockPlantingFacts {
  cropPluginId: string;
  plantingDate: number | null;
  status?: string;
}

const GONE_STATUSES = new Set(['harvested', 'archived', 'failed']);

/** Plantings standing on the block at `atMs`: dated on or before it and
 *  not harvested out, archived or failed. Undated or later plantings are
 *  plans, so a block holding only plans stays a pre-plant block. */
export function standingCropPluginIds(
  plantings: readonly BlockPlantingFacts[],
  atMs: number
): string[] {
  return plantings
    .filter(
      (p) => !GONE_STATUSES.has(p.status ?? '') && p.plantingDate != null && p.plantingDate <= atMs
    )
    .map((p) => p.cropPluginId);
}

export function resolveSprayCrops(
  client: { primary: ClientSprayCrop; coPlanted?: readonly ClientSprayCrop[] },
  standing: readonly string[],
  registry: SprayCropRegistry
): { primary: CropStage; coPlanted: CropStage[] } {
  const seen = new Set<string>();
  const crops: CropStage[] = [];
  const add = (cropPluginId: string, clientFamily?: CropFamily) => {
    if (seen.has(cropPluginId)) return;
    seen.add(cropPluginId);
    crops.push({
      cropPluginId,
      cropFamily: registry.cropFamilyOf(cropPluginId) ?? clientFamily,
      traits: [...registry.cropTraitsOf(cropPluginId)]
    });
  };
  add(client.primary.cropPluginId, client.primary.cropFamily);
  for (const c of client.coPlanted ?? []) add(c.cropPluginId, c.cropFamily);
  for (const id of standing) add(id);

  const known = crops.filter((c) => c.cropFamily);
  const pool = known.length > 0 ? known : crops;
  const primary =
    pool.find((c) => c.cropFamily === 'corn') ??
    pool.find((c) => c.cropPluginId === client.primary.cropPluginId) ??
    pool[0];
  return {
    primary: {
      ...primary,
      heightInches: client.primary.heightInches,
      growthStage: client.primary.growthStage
    },
    coPlanted: crops.filter((c) => c !== primary)
  };
}
