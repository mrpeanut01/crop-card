/** Phase 37C: builds the snapshot's optional `pantry` part. Absent when the
 *  farm has no herb planting, no brief goal and nothing kept this season. */

import type { SnapshotPantry } from '$lib/garden/pantrySnapshot';
import { goalLinesFor, loadBriefGoals, loadHarvestSchedule, loadKeptTotals } from './pantry.server';

export async function pantrySnapshotPart(now: number): Promise<{ pantry?: SnapshotPantry }> {
  const goals = loadBriefGoals();
  const loaded = await loadHarvestSchedule({ herbsOnly: true, now });
  const kept = loadKeptTotals(loaded.year);
  if (goals.length === 0 && loaded.plantings.length === 0 && kept.length === 0) return {};
  return {
    pantry: {
      year: loaded.year,
      goals: await goalLinesFor(loaded, goals),
      kept
    }
  };
}
