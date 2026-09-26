/**
 * Bed history, rotation warnings and companion hints for the designer.
 * Rotation wraps `buildRotationSuggestion` (lib/season/carryForwardPlan.ts);
 * companions read `goodWith`/`badWith` from companion plugins.
 */

import type { CompanionPlugin } from '$lib/plugins/schemas';
import type {
  BedHistoryEntry,
  BedLayout,
  CompanionHint,
  OccupancyInterval,
  PlacedPlanting,
  RotationWarning
} from './types';

export const ROTATION_HISTORY_YEARS = 4;

function notImplemented(name: string): never {
  throw new Error(`lib/garden/rotation.${name}: not implemented`);
}

/** Newest first, grouped by `seasonYear`, at most `ROTATION_HISTORY_YEARS`
 *  seasons before `seasonYear` plus the current one. */
export function bedHistory(
  _history: readonly BedHistoryEntry[],
  _seasonYear: number
): BedHistoryEntry[] {
  return notImplemented('bedHistory');
}

/** Warnings for planting `candidateFamily` in this bed in `seasonYear`, one
 *  per family that repeats inside its plant-back window. Earlier plantings in
 *  the same season count as the prior season (a second tomato after spring
 *  tomatoes still warns). */
export function rotationWarnings(
  _blockId: string,
  _blockName: string,
  _history: readonly BedHistoryEntry[],
  _candidateFamily: string,
  _seasonYear: number,
  _lookbackByFamily: Readonly<Record<string, number>>
): RotationWarning[] {
  return notImplemented('rotationWarnings');
}

/** Hints for plantings whose intervals overlap in time, in the same bed or in
 *  beds `adjacentBeds` pairs. Good: both crops in one plugin's `goodWith`, or
 *  one there and the other's family equal to its `primaryFamily` or a
 *  `members[].family`. Keep apart: both in one plugin's `badWith`. One hint
 *  per companion plugin per crop pair; `keep-apart` sorts first. */
export function companionHints(
  _beds: readonly BedLayout[],
  _plantings: readonly PlacedPlanting[],
  _intervals: readonly OccupancyInterval[],
  _companions: readonly CompanionPlugin[],
  _adjacency: ReadonlyArray<readonly [string, string]>
): CompanionHint[] {
  return notImplemented('companionHints');
}
