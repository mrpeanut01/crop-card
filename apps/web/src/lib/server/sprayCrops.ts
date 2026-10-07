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
  harvestedAt?: number | null;
  archivedAt?: number | null;
}

/** #676 / #637: whether a planting is in the ground at `atMs`. It must be
 *  dated on or before `atMs`; a harvested or archived planting stops
 *  counting only from the moment it was marked so, so a backdated record
 *  still sees it. A failed planting, or a gone one with no date on file,
 *  still counts, since the kernel is never judged against fewer crops than
 *  may be standing. Undated or later plantings are plans. */
export function plantingStandsAt(p: BlockPlantingFacts, atMs: number): boolean {
  if (p.plantingDate == null || p.plantingDate > atMs) return false;
  if (p.status !== 'harvested' && p.status !== 'archived') return true;
  const stamps = [p.harvestedAt, p.archivedAt].filter(
    (t): t is number => t != null && Number.isFinite(t)
  );
  if (stamps.length === 0) return true;
  return Math.min(...stamps) > atMs;
}

export const plantingStandsForBloom = plantingStandsAt;

/** Crops standing on the block at `atMs` (see `plantingStandsAt`). A block
 *  holding only plans stays a pre-plant block. */
export function standingCropPluginIds(
  plantings: readonly BlockPlantingFacts[],
  atMs: number
): string[] {
  return plantings.filter((p) => plantingStandsAt(p, atMs)).map((p) => p.cropPluginId);
}

/** A planting that is still a plan at `atMs`: undated or dated later, and
 *  not harvested, archived or failed. */
export function plantingPlannedAt(p: BlockPlantingFacts, atMs: number): boolean {
  if (p.status === 'harvested' || p.status === 'archived' || p.status === 'failed') return false;
  return p.plantingDate == null || p.plantingDate > atMs;
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
