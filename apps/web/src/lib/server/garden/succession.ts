/**
 * "Add N sowings" (Phase 30E). The server recomputes the proposal from the
 * bed's stored plantings, so a stale client can never place a sowing on top
 * of something else, then commits the sowings that fit as one succession
 * group through `createPlantingGroup`.
 */

import { createPlantingGroup, getCrop, listCrops, type GroupMemberInput } from '$lib/db/crops';
import type { SuccessionRequest, SuccessionResponse } from '$lib/garden/api';
import { ONE_DAY_MS, occupancyIntervals } from '$lib/garden/occupancy';
import { proposeSuccession } from '$lib/garden/succession';
import type { GardenCrop } from '$lib/garden/types';
import type { CropPlugin } from '$lib/plugins/schemas';
import { frostDatesForYear } from '$lib/schedule/settings';
import {
  gardenFailure,
  isFailure,
  placedPlantingFromCrop,
  resolveDesignableBed,
  resolvePlacement,
  type GardenFailure
} from './placement';

export type SuccessionResult = { ok: true; response: SuccessionResponse } | GardenFailure;

export function addSuccession(
  blockId: string,
  req: SuccessionRequest,
  crops: Readonly<Record<string, CropPlugin>>
): SuccessionResult {
  const bed = resolveDesignableBed(blockId);
  if (isFailure(bed)) return bed;
  const anchorCrop = getCrop(req.cropId);
  if (!anchorCrop || anchorCrop.blockId !== bed.block.id) {
    return gardenFailure(404, 'planting not found in this bed');
  }
  if (anchorCrop.status !== 'planned' && anchorCrop.status !== 'active') {
    return gardenFailure(
      409,
      `${anchorCrop.varietyDisplayName} is finished for the season. Pick a current planting.`
    );
  }
  if (req.commit && anchorCrop.groupId) {
    return gardenFailure(
      409,
      `${anchorCrop.varietyDisplayName} is already linked to other plantings. Add sowings from its first planting.`
    );
  }
  const plugin: GardenCrop | undefined = crops[anchorCrop.cropPluginId];
  const anchor = placedPlantingFromCrop(anchorCrop, plugin);
  const year = new Date(anchor.plantingDateMs ?? Date.now()).getUTCFullYear();
  const { firstFallFrostMs } = frostDatesForYear(year);
  const intervals = occupancyIntervals(
    listCrops({ blockId: bed.block.id }).map((c) =>
      placedPlantingFromCrop(c, crops[c.cropPluginId])
    ),
    crops,
    { firstFallFrostMs }
  );
  const proposal = proposeSuccession({
    anchor,
    crop: plugin,
    bed: { blockId: bed.block.id, widthFt: bed.widthFt, lengthFt: bed.lengthFt },
    count: req.count,
    intervalDays: req.intervalDays,
    intervals,
    firstFallFrostMs
  });
  if (!req.commit) return { ok: true, response: { proposal, groupId: null, created: [] } };

  const sowings = proposal.sowings.filter((s) => s.footprint && !s.conflict);
  if (!plugin || anchor.plantingDateMs == null || sowings.length === 0) {
    return gardenFailure(409, proposal.reason || 'No sowing fits this bed.');
  }
  const anchorDateMs = anchor.plantingDateMs;
  const companions: GroupMemberInput[] = sowings.map((s) => ({
    cropPluginId: anchorCrop.cropPluginId,
    varietyDisplayName: anchorCrop.varietyDisplayName,
    offsetDays: Math.round((s.plantingDateMs - anchorDateMs) / ONE_DAY_MS),
    placement: resolvePlacement(
      {
        footprint: s.footprint,
        spacingPattern: anchor.spacing.pattern,
        spacingIn: anchorCrop.spacingIn ?? null,
        rowSpacingIn: anchorCrop.rowSpacingIn ?? null
      },
      plugin
    )
  }));
  const result = createPlantingGroup({
    blockId: bed.block.id,
    anchor: {
      cropPluginId: anchorCrop.cropPluginId,
      varietyDisplayName: anchorCrop.varietyDisplayName,
      existingCropId: anchorCrop.id,
      keepExistingTasks: true
    },
    companions,
    anchorPlantingDateMs: anchorDateMs,
    systemKind: 'succession',
    resolvePlugin: (id) => crops[id]
  });
  const [anchorOut, ...members] = result.members;
  return {
    ok: true,
    response: {
      proposal,
      groupId: result.groupId,
      anchor: placedPlantingFromCrop(anchorOut.crop, plugin),
      created: members.map((m) => placedPlantingFromCrop(m.crop, plugin))
    }
  };
}
