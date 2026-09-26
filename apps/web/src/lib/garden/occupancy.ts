/**
 * Bed occupancy over time, for the time scrubber. The interval rule is the
 * one `scheduleCandidacy` uses, so the designer and the allocation wizard
 * agree: see docs/design/GARDEN_DESIGNER.md ("Occupancy").
 */

import type { Archetype } from '$lib/plugins/schemas';
import type {
  BedLayout,
  BedOccupancyOnDate,
  GardenCrop,
  OccupancyInterval,
  PlacedPlanting,
  ScrubRange
} from './types';

export const BED_TURNOVER_DAYS = 10;
export const FALLBACK_DTM_DAYS = 90;

/** Days a harvest runs past `daysToMaturity.max`. `until-frost` ends it at the
 *  first fall frost and `season` holds the bed from planting to that frost. */
export type HarvestTail = number | 'until-frost' | 'season';

export const ARCHETYPE_HARVEST_TAIL: Record<Archetype, HarvestTail> = {
  'small-grain.zadoks': 0,
  'row-grain.pollination': 0,
  'dry-seed-legume': 0,
  'winter-squash-cure': 0,
  'continuous-harvest-fruit': 'until-frost',
  'cut-and-come-again-leafy': 21,
  'cover-crop.termination': 0,
  'forage-cutting-cycle': 'season',
  'perennial-vine-quality': 'season',
  'tree-fruit-multi-pick': 'season'
};

export interface OccupancyOptions {
  firstFallFrostMs: number;
}

export type OccupancyPlanting = Pick<
  PlacedPlanting,
  | 'cropId'
  | 'blockId'
  | 'cropPluginId'
  | 'status'
  | 'plantingDateMs'
  | 'harvestedAtMs'
  | 'footprint'
>;

function notImplemented(name: string): never {
  throw new Error(`lib/garden/occupancy.${name}: not implemented`);
}

/** Null for unscheduled, failed or archived plantings. A recorded harvest
 *  date replaces the estimated harvest end and sets `actual`. */
export function plantingOccupancy(
  _planting: OccupancyPlanting,
  _crop: GardenCrop | undefined,
  _opts: OccupancyOptions
): OccupancyInterval | null {
  return notImplemented('plantingOccupancy');
}

export function occupancyIntervals(
  _plantings: readonly OccupancyPlanting[],
  _crops: Readonly<Record<string, GardenCrop>>,
  _opts: OccupancyOptions
): OccupancyInterval[] {
  return notImplemented('occupancyIntervals');
}

/** A day is occupied when `startMs <= day < endMs`. */
export function bedOccupancyOn(
  _bed: Pick<BedLayout, 'blockId' | 'widthFt' | 'lengthFt'>,
  _intervals: readonly OccupancyInterval[],
  _dateMs: number,
  _range: ScrubRange
): BedOccupancyOnDate {
  return notImplemented('bedOccupancyOn');
}

/** Jan 1 of `seasonYear` to Dec 31, widened to cover every interval that
 *  touches the year. `todayMs` is clamped into the range. */
export function scrubRange(
  _seasonYear: number,
  _intervals: readonly OccupancyInterval[],
  _nowMs: number
): ScrubRange {
  return notImplemented('scrubRange');
}

/** Day starts where the bed changes (a planting goes in or comes out), for
 *  the slider's tick marks and keyboard PageUp/PageDown stops. */
export function occupancyChangeDays(
  _intervals: readonly OccupancyInterval[],
  _blockId?: string
): number[] {
  return notImplemented('occupancyChangeDays');
}
