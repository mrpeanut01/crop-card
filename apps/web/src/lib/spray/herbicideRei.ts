const HOUR_MS = 60 * 60 * 1000;

export interface HerbicideSprayForRei {
  id: string;
  blockId: string;
  occurredAt: number;
  products: ReadonlyArray<{ pluginId: string }>;
}

export interface ActiveHerbicideRei {
  id: string;
  blockId: string;
  reEntryClearAt: number;
}

/** #640: herbicide spray records store no re-entry time, so it is derived
 *  from the label REI of each product in the tank (the longest wins). A
 *  spray whose products have no REI on file is left out. */
export function activeHerbicideReEntry(
  events: readonly HerbicideSprayForRei[],
  reiHoursOf: (pluginId: string) => number | undefined,
  now: number
): ActiveHerbicideRei[] {
  const out: ActiveHerbicideRei[] = [];
  for (const e of events) {
    let hours: number | undefined;
    for (const p of e.products) {
      const h = reiHoursOf(p.pluginId);
      if (typeof h === 'number' && Number.isFinite(h) && h > 0) {
        hours = Math.max(hours ?? 0, h);
      }
    }
    if (hours === undefined) continue;
    const reEntryClearAt = e.occurredAt + hours * HOUR_MS;
    if (reEntryClearAt >= now) out.push({ id: e.id, blockId: e.blockId, reEntryClearAt });
  }
  return out.sort((a, b) => a.reEntryClearAt - b.reEntryClearAt);
}

/** How far back a spray can be and still hold an REI today. */
export function herbicideReiLookbackMs(reiHours: Iterable<number | undefined>): number {
  let max = 0;
  for (const h of reiHours) if (typeof h === 'number' && h > max) max = h;
  return max * HOUR_MS;
}
