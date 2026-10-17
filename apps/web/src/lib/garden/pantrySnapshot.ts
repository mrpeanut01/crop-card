/** Phase 37C: the `pantry` part of the offline card snapshot. Client-safe;
 *  `lib/server/pantrySnapshot.ts` builds it. */

import type { GoalLine } from './harvestSchedule';
import type { PreservingMethod } from './preserving';
import { goalLineText } from './pantryText';
import { isHerbGardenCrop } from './herbs';

export interface SnapshotPantry {
  year: number;
  goals: GoalLine[];
  kept: Array<{
    cropPluginId: string;
    method: PreservingMethod | null;
    unit: string;
    quantity: number;
  }>;
}

/** The goal lines an offline Planting card shows: every goal, on an herb
 *  planting only. Empty when the bundle has no pantry part. */
export function plantingGoalLines(
  pantry: SnapshotPantry | undefined,
  cropPluginId: string,
  cropName: (pluginId: string) => string,
  locale?: string | null
): string[] {
  if (!pantry || !isHerbGardenCrop(cropPluginId)) return [];
  return pantry.goals.map((g) => goalLineText(g, cropName, locale));
}
