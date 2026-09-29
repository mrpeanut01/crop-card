/**
 * Where to draw scheduled plantings that have no spot in their bed yet
 * (#481). Display only: nothing here is saved. The designer outlines each
 * one dashed and marked "not placed yet" until the owner drags it or taps
 * Place; the printed Area Card uses the same spots.
 *
 * Each planting asks for room for its planned count, else the bed's width by
 * 2 ft, and is packed into space that no placed planting uses at the same
 * time. A planting that does not fit anywhere is left out and listed.
 */

import { fitFootprint } from './geometry';
import { intervalsOverlapInTime } from './occupancy';
import { footprintForCount, resolveSpacing } from './plantCount';
import type { BedLayout, Footprint, GardenCrop, OccupancyInterval, PlacedPlanting } from './types';

/** Same default as a crop tapped into a bed with no planned count. */
export const UNPLACED_LENGTH_IN = 24;

type Planting = Pick<
  PlacedPlanting,
  'cropId' | 'blockId' | 'cropPluginId' | 'footprint' | 'plantCount' | 'spacing'
>;

export function wantedFootprintSize(
  p: Pick<Planting, 'plantCount' | 'spacing'> & { cropPluginId: string },
  bed: Pick<BedLayout, 'widthFt' | 'lengthFt'>,
  crop?: GardenCrop
): { w_in: number; l_in: number } {
  const bedW = bed.widthFt * 12;
  const bedL = bed.lengthFt * 12;
  if (p.plantCount != null && p.plantCount > 0) {
    const spacing = p.spacing ?? resolveSpacing(crop, 'square');
    const want = footprintForCount(p.plantCount, spacing, bedW);
    return { w_in: Math.min(want.w_in, bedW), l_in: Math.min(want.l_in, bedL) };
  }
  return { w_in: bedW, l_in: Math.min(bedL, UNPLACED_LENGTH_IN) };
}

/** Display spots for every unplaced planting that has a time in the ground,
 *  keyed by crop id. */
export function displayFootprints(
  beds: readonly BedLayout[],
  plantings: readonly Planting[],
  intervals: readonly OccupancyInterval[],
  crops: Readonly<Record<string, GardenCrop>> = {}
): Map<string, Footprint> {
  const out = new Map<string, Footprint>();
  const byCrop = new Map(intervals.map((i) => [i.cropId, i]));
  const bedById = new Map(beds.map((b) => [b.blockId, b]));
  const unplaced = plantings
    .filter((p) => !p.footprint && byCrop.has(p.cropId) && bedById.has(p.blockId))
    .sort(
      (a, b) =>
        byCrop.get(a.cropId)!.startMs - byCrop.get(b.cropId)!.startMs ||
        (a.cropId < b.cropId ? -1 : a.cropId > b.cropId ? 1 : 0)
    );
  const packed: Array<{ blockId: string; span: OccupancyInterval; footprint: Footprint }> = [];
  for (const p of unplaced) {
    const bed = bedById.get(p.blockId)!;
    const span = byCrop.get(p.cropId)!;
    const taken: Footprint[] = [
      ...intervals
        .filter(
          (i) =>
            i.blockId === bed.blockId &&
            i.cropId !== p.cropId &&
            i.footprint !== null &&
            intervalsOverlapInTime(i, span)
        )
        .map((i) => i.footprint as Footprint),
      ...packed
        .filter((q) => q.blockId === bed.blockId && intervalsOverlapInTime(q.span, span))
        .map((q) => q.footprint)
    ];
    const fp = fitFootprint(bed, wantedFootprintSize(p, bed, crops[p.cropPluginId]), taken);
    if (!fp) continue;
    out.set(p.cropId, fp);
    packed.push({ blockId: bed.blockId, span, footprint: fp });
  }
  return out;
}
