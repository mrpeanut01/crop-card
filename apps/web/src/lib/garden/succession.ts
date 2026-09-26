/**
 * "Add succession" proposals for a placed planting. Intervals come from
 * `FAMILY_SUCCESSION_DAYS`; committing goes through `createPlantingGroup`
 * with `systemKind: 'succession'`. Spec: docs/design/GARDEN_DESIGNER.md.
 */

import type {
  BedLayout,
  GardenCrop,
  OccupancyInterval,
  PlacedPlanting,
  SuccessionProposal
} from './types';

export const MAX_SUCCESSIONS = 6;

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

function notImplemented(name: string): never {
  throw new Error(`lib/garden/succession.${name}: not implemented`);
}

/** Each sowing keeps the anchor's footprint size and takes the free spot in
 *  the same bed closest to the anchor on its date. A sowing that cannot
 *  mature before first fall frost, or has no room, carries a `conflict`. A
 *  family with a 0-day interval returns no sowings and says why. */
export function proposeSuccession(_input: SuccessionInput): SuccessionProposal {
  return notImplemented('proposeSuccession');
}
