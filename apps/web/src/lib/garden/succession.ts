/**
 * "Add succession" proposals for a placed planting. Intervals come from
 * `FAMILY_SUCCESSION_DAYS`; committing goes through `createPlantingGroup`
 * with `systemKind: 'succession'`. Spec: docs/design/GARDEN_DESIGNER.md.
 */

import { evaluateSuccessionFit, successionIntervalDays } from '$lib/schedule/succession';
import { placeFootprint } from './geometry';
import {
  frostInYearOf,
  intervalsOverlapInTime,
  maturityDays,
  ONE_DAY_MS,
  plantingOccupancy,
  shortDate
} from './occupancy';
import { plantCount } from './plantCount';
import type {
  BedLayout,
  Footprint,
  GardenCrop,
  OccupancyInterval,
  PlacedPlanting,
  SuccessionProposal,
  SuccessionSowing
} from './types';

export const MAX_SUCCESSIONS = 6;

const LATEST_SOWING_BUFFER_DAYS = 14;

export interface SuccessionInput {
  anchor: PlacedPlanting;
  crop: GardenCrop | undefined;
  bed: Pick<BedLayout, 'blockId' | 'widthFt' | 'lengthFt'>;
  /** Sowings to add after the anchor, 1 to `MAX_SUCCESSIONS - 1`. */
  count: number;
  /** Overrides the family interval; the proposal then says `manual`. */
  intervalDays?: number;
  /** Every interval on this bed, the anchor's included. */
  intervals: readonly OccupancyInterval[];
  firstFallFrostMs: number;
}

function centerOf(fp: Footprint): { xIn: number; yIn: number } {
  return { xIn: fp.x_in + fp.w_in / 2, yIn: fp.y_in + fp.l_in / 2 };
}

/** Each sowing keeps the anchor's footprint size and takes the free spot in
 *  the same bed closest to the anchor on its date. A sowing that cannot
 *  mature before first fall frost, or has no room, carries a `conflict`. A
 *  family with a 0-day interval returns no sowings and says why. */
export function proposeSuccession(input: SuccessionInput): SuccessionProposal {
  const { anchor, crop, bed } = input;
  const name = crop?.displayName ?? anchor.varietyDisplayName;
  const family = crop?.cropFamily ?? anchor.cropFamily;
  const manual =
    typeof input.intervalDays === 'number' &&
    Number.isFinite(input.intervalDays) &&
    input.intervalDays >= 1;
  const intervalDays = manual
    ? Math.round(input.intervalDays as number)
    : successionIntervalDays(family);
  const base = {
    anchorCropId: anchor.cropId,
    blockId: bed.blockId,
    intervalDays,
    intervalSource: manual ? ('manual' as const) : ('family' as const)
  };

  if (anchor.plantingDateMs == null) {
    return { ...base, sowings: [], reason: `Give ${name} a planting date first.` };
  }
  if (intervalDays <= 0) {
    return {
      ...base,
      sowings: [],
      reason: `${name} doesn't usually succession-sow here. Plant once.`
    };
  }

  const count = Math.min(MAX_SUCCESSIONS - 1, Math.max(1, Math.round(input.count || 1)));
  const anchorMs = anchor.plantingDateMs;
  const dtm = maturityDays(crop);
  const existing = input.intervals.filter((i) => i.blockId === bed.blockId);
  const accepted: OccupancyInterval[] = [];
  const sowings: SuccessionSowing[] = [];

  for (let index = 1; index <= count; index++) {
    const plantingDateMs = anchorMs + index * intervalDays * ONE_DAY_MS;
    const frostMs = frostInYearOf(input.firstFallFrostMs, plantingDateMs);
    if (plantingDateMs + dtm.max * ONE_DAY_MS > frostMs) {
      sowings.push({
        index,
        plantingDateMs,
        footprint: null,
        plantCount: null,
        conflict: `Sown ${shortDate(plantingDateMs)}, it would not mature before the first fall frost on ${shortDate(frostMs)}.`
      });
      continue;
    }
    const probe = plantingOccupancy(
      {
        cropId: `${anchor.cropId}#${index}`,
        blockId: bed.blockId,
        cropPluginId: anchor.cropPluginId,
        status: 'planned',
        plantingDateMs,
        harvestedAtMs: null,
        footprint: anchor.footprint
      },
      crop,
      { firstFallFrostMs: input.firstFallFrostMs }
    );
    if (!probe) continue;
    const sharing = [...existing, ...accepted].filter((i) => intervalsOverlapInTime(i, probe));
    let footprint: Footprint | null = null;
    let fits: boolean;
    if (anchor.footprint) {
      footprint = sharing.some((i) => i.footprint === null)
        ? null
        : placeFootprint(
            bed,
            anchor.footprint,
            sharing.map((i) => i.footprint as Footprint),
            centerOf(anchor.footprint)
          );
      fits = footprint !== null;
    } else {
      fits = sharing.length === 0;
    }
    if (!fits) {
      sowings.push({
        index,
        plantingDateMs,
        footprint: null,
        plantCount: null,
        conflict: `No room in this bed on ${shortDate(plantingDateMs)}.`
      });
      continue;
    }
    const plants =
      footprint && anchor.plantCountProvenance !== 'manual'
        ? plantCount(footprint, anchor.spacing).count
        : anchor.plantCount;
    accepted.push({ ...probe, footprint });
    sowings.push({ index, plantingDateMs, footprint, plantCount: plants, conflict: null });
  }

  const fitting = sowings.filter((s) => s.conflict === null).length;
  const firstFrost = frostInYearOf(input.firstFallFrostMs, anchorMs);
  const fit = evaluateSuccessionFit(
    {
      stockItemId: anchor.cropId,
      blockId: bed.blockId,
      earliestMs: anchorMs,
      latestMs: firstFrost - (dtm.max + LATEST_SOWING_BUFFER_DAYS) * ONE_DAY_MS,
      hardiness: 'half-hardy',
      dtmDaysMax: dtm.max
    },
    { cropFamily: family, daysToMaturity: dtm },
    bed.blockId,
    anchor.cropId
  );
  let reason = `Sow again every ${intervalDays} days.`;
  reason +=
    fitting === count
      ? count === 1
        ? ' The next sowing fits.'
        : ` All ${count} sowings fit.`
      : ` ${fitting} of ${count} sowings fit. The others say why.`;
  if (fit.eligible && fit.maxPlantings < count + 1) {
    reason += ` The season holds about ${fit.maxPlantings} sowings in all.`;
  }
  return { ...base, sowings, reason };
}
