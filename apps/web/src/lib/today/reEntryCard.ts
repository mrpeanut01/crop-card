/**
 * Ruling LF-3 (#640): the active re-entry card on /today, built in memory
 * from the spray, insecticide and fungicide rows the loader already reads
 * for the year-to-date count. Herbicide REIs come from the library through
 * `herbicideReEntryFor`; insecticide and fungicide REIs from the clear time
 * stored on the record.
 */
import type { PluginRegistry } from '$lib/plugins';
import type { SprayEvent } from '$lib/db/sprayEvents';
import type { InsecticideEvent } from '$lib/db/insecticideEvents';
import type { FungicideEvent } from '$lib/db/fungicideEvents';
import { herbicideReEntryFor, reEntryActive } from '$lib/spray/herbicideReEntry';

const HOUR_MS = 60 * 60 * 1000;

type RegistryView = Pick<PluginRegistry, 'get' | 'all'>;

export type ReEntryRecordKind = 'spray' | 'insecticide' | 'fungicide';

export interface ReEntryCardItem {
  recordKind: ReEntryRecordKind;
  recordId: string;
  blockId: string;
  /** Null when the block is no longer on the farm. */
  blockName: string | null;
  products: string[];
  /** Null when not every product in the tank has an REI on file, so no
   *  clear time is ever shown for it. */
  clearAt: number | null;
}

const longestByRegistry = new WeakMap<object, number>();

function validHours(h: unknown): h is number {
  return typeof h === 'number' && Number.isFinite(h) && h >= 0;
}

/** The longest REI any herbicide, insecticide or fungicide in the library
 *  has on file, in hours. */
export function longestLibraryReiHours(registry: RegistryView): number {
  const hit = longestByRegistry.get(registry);
  if (hit !== undefined) return hit;
  let longest = 0;
  for (const r of registry.all()) {
    const p = r.plugin as { type: string; reEntryIntervalHours?: unknown };
    if (p.type !== 'herbicide' && p.type !== 'insecticide' && p.type !== 'fungicide') continue;
    if (validHours(p.reEntryIntervalHours)) longest = Math.max(longest, p.reEntryIntervalHours);
  }
  longestByRegistry.set(registry, longest);
  return longest;
}

/** Where the /today spray read starts: the start of the year, or earlier
 *  when the longest REI in the library reaches back past it. */
export function reEntryReadStart(yearStart: number, now: number, longestHours: number): number {
  return Math.min(yearStart, now - Math.max(0, longestHours) * HOUR_MS);
}

export interface ReEntryCardInput {
  registry: RegistryView;
  sprays: ReadonlyArray<
    Pick<SprayEvent, 'id' | 'blockId' | 'occurredAt' | 'reEntryClearAt' | 'products'>
  >;
  insecticides: ReadonlyArray<
    Pick<InsecticideEvent, 'id' | 'blockId' | 'reEntryClearAt' | 'products'>
  >;
  fungicides: ReadonlyArray<Pick<FungicideEvent, 'id' | 'blockId' | 'reEntryClearAt' | 'products'>>;
  blockNameById: ReadonlyMap<string, string>;
  now: number;
}

/** Every spray still inside its REI at `now`, soonest clear first. A spray
 *  with no REI on file for any product is left out; one with some products
 *  missing an REI stays while the known part runs, with no clear time. */
export function activeReEntryItems(input: ReEntryCardInput): ReEntryCardItem[] {
  const { registry, blockNameById, now } = input;
  const rows: Array<ReEntryCardItem & { sortAt: number }> = [];
  const blockName = (id: string) => blockNameById.get(id) ?? null;

  for (const ev of input.sprays) {
    const rei = herbicideReEntryFor(registry, ev);
    if (!rei || !reEntryActive(rei, now)) continue;
    rows.push({
      recordKind: 'spray',
      recordId: ev.id,
      blockId: ev.blockId,
      blockName: blockName(ev.blockId),
      products: ev.products.map((p) => registry.get(p.pluginId)?.plugin.displayName ?? p.pluginId),
      clearAt: rei.complete ? rei.clearAt : null,
      sortAt: rei.clearAt
    });
  }
  const stored = (
    kind: 'insecticide' | 'fungicide',
    evs: ReEntryCardInput['insecticides'] | ReEntryCardInput['fungicides']
  ) => {
    for (const ev of evs) {
      const clearAt = ev.reEntryClearAt;
      if (typeof clearAt !== 'number' || clearAt < now) continue;
      rows.push({
        recordKind: kind,
        recordId: ev.id,
        blockId: ev.blockId,
        blockName: blockName(ev.blockId),
        products: ev.products.map((p) => p.displayName || p.pluginId),
        clearAt,
        sortAt: clearAt
      });
    }
  };
  stored('insecticide', input.insecticides);
  stored('fungicide', input.fungicides);

  rows.sort(
    (a, b) =>
      a.sortAt - b.sortAt ||
      a.recordKind.localeCompare(b.recordKind) ||
      a.recordId.localeCompare(b.recordId)
  );
  return rows.map(({ sortAt: _sortAt, ...item }) => item);
}
