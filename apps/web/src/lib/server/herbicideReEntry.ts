import type { PluginRegistry } from '$lib/plugins';
import { sprayEventsForReEntry, type SprayEvent } from '$lib/db/sprayEvents';
import {
  herbicideReEntryFor,
  herbicideReiHoursOf,
  longestHerbicideReiHours,
  reEntryActive
} from '$lib/spray/herbicideReEntry';

export { herbicideReEntryFor, herbicideReiHoursOf, longestHerbicideReiHours };

const HOUR_MS = 60 * 60 * 1000;

type RegistryView = Pick<PluginRegistry, 'get' | 'all'>;

export interface ActiveHerbicideReEntry {
  id: string;
  blockId: string;
  reEntryClearAt: number;
  complete: boolean;
}

/** #640: the active Owner's herbicide sprays still inside a re-entry
 *  interval, for the /spray page. A spray whose products have no REI on
 *  file is left out. */
export function activeHerbicideReEntryRestrictions(
  registry: RegistryView,
  now: number = Date.now()
): ActiveHerbicideReEntry[] {
  const lookbackMs = longestHerbicideReiHours(registry) * HOUR_MS;
  const out: ActiveHerbicideReEntry[] = [];
  for (const ev of sprayEventsForReEntry(now, lookbackMs)) {
    const rei = herbicideReEntryFor(registry, ev);
    if (!rei || !reEntryActive(rei, now)) continue;
    out.push({
      id: ev.id,
      blockId: ev.blockId,
      reEntryClearAt: rei.clearAt,
      complete: rei.complete
    });
  }
  return out.sort((a, b) => a.reEntryClearAt - b.reEntryClearAt);
}

/** The clear time a herbicide spray record shows: only when every product
 *  in the tank has an REI on file, so a record never claims a clear time
 *  that another product's label may push later. */
export function herbicideReEntryClearAtFor(
  registry: RegistryView,
  ev: Pick<SprayEvent, 'occurredAt' | 'reEntryClearAt' | 'products'>
): number | null {
  const rei = herbicideReEntryFor(registry, ev);
  return rei?.complete ? rei.clearAt : null;
}
