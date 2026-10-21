/** Phase 37C: the `pantry` part of the offline card snapshot. Client-safe;
 *  `lib/server/pantrySnapshot.ts` builds it. */

import { bestPreservingRow, type GoalLine, type PreservingRow } from './harvestSchedule';
import type { PreservingMethod } from './preserving';
import { goalLineText } from './pantryText';
import { isHerbGardenCrop } from './herbs';
import { infuseMediaOf, infuseSafetyLine } from './infuse';

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

/** The goal lines an offline or live Planting card shows (CO-10): on an herb
 *  planting, only the goals the herb's own `preserving` can meet (a row
 *  rated good or fair for the goal's method), and under an infuse goal the
 *  food-safety line of each medium the herb infuses well in. Empty when the
 *  bundle has no pantry part or the herb has no preserving data. */
export function plantingGoalLines(
  pantry: SnapshotPantry | undefined,
  cropPluginId: string,
  cropName: (pluginId: string) => string,
  locale?: string | null,
  preserving?: readonly PreservingRow[]
): string[] {
  if (!pantry || !isHerbGardenCrop(cropPluginId) || !preserving?.length) return [];
  const out: string[] = [];
  for (const g of pantry.goals) {
    if (!g.method) continue;
    const row = bestPreservingRow(preserving, g.method);
    if (!row || (row.suitability !== 'good' && row.suitability !== 'fair')) continue;
    out.push(goalLineText(g, cropName, locale));
    if (g.method === 'infuse') {
      for (const m of infuseMediaOf(preserving, true)) out.push(infuseSafetyLine(m, locale));
    }
  }
  return out;
}
