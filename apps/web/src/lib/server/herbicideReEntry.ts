import type { PluginRegistry } from '$lib/plugins';
import { sprayEventsForReEntry, type SprayEvent } from '$lib/db/sprayEvents';
import {
  herbicideReEntry,
  reEntryActive,
  type HerbicideReEntry
} from '$lib/spray/herbicideReEntry';

const HOUR_MS = 60 * 60 * 1000;

type RegistryView = Pick<PluginRegistry, 'get' | 'all'>;

/** A herbicide's sourced REI in hours; undefined when none is on file. */
export function herbicideReiHoursOf(registry: RegistryView, pluginId: string): number | undefined {
  const plugin = registry.get(pluginId)?.plugin;
  if (!plugin || plugin.type !== 'herbicide') return undefined;
  const h = plugin.reEntryIntervalHours;
  return typeof h === 'number' && Number.isFinite(h) && h >= 0 ? h : undefined;
}

export function longestHerbicideReiHours(registry: RegistryView): number {
  let longest = 0;
  for (const r of registry.all()) {
    if (r.plugin.type !== 'herbicide') continue;
    const h = herbicideReiHoursOf(registry, r.plugin.pluginId);
    if (h !== undefined) longest = Math.max(longest, h);
  }
  return longest;
}

/** One herbicide spray record's re-entry window, from its stored clear time
 *  and the library's REIs now. */
export function herbicideReEntryFor(
  registry: RegistryView,
  ev: Pick<SprayEvent, 'occurredAt' | 'reEntryClearAt' | 'products'>
): HerbicideReEntry | null {
  return herbicideReEntry(
    ev.occurredAt,
    ev.reEntryClearAt,
    ev.products.map((p) => herbicideReiHoursOf(registry, p.pluginId))
  );
}

export interface ActiveHerbicideReEntry {
  id: string;
  blockId: string;
  reEntryClearAt: number;
  complete: boolean;
}

/** #640: the active Owner's herbicide sprays still inside a re-entry
 *  interval. A spray whose products have no REI on file is left out. */
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
