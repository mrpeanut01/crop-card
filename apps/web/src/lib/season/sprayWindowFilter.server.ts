import type { HerbicidePlugin } from '$lib/plugins/schemas';
import { seasonOfPlanting } from '$lib/today/seasonTimeline';
import { activePlanningYearAndFrost, type planningFrost } from './planningYear.server';
import { loadSeasonSetup } from './setup.server';
import {
  buildSeasonSprayFilter,
  filterSprayWindowsBySeason,
  type SeasonSprayFilter
} from './sprayWindowFilter';

/** Drops the calendar's herbicide windows that the farm's Season Setup for
 *  each planting's season does not allow. Reads settings only when a spray
 *  window is on the list, and each season's setup once. */
export function applySeasonSprayFilter<
  E extends { kind: string; detail?: Record<string, unknown> }
>(
  events: ReadonlyArray<E>,
  herbicides: () => ReadonlyArray<HerbicidePlugin>,
  now: number = Date.now()
): E[] {
  if (!events.some((e) => e.kind === 'spray-window')) return [...events];
  const byYear = new Map<number, SeasonSprayFilter | null>();
  let pool: ReadonlyArray<HerbicidePlugin> | null = null;
  let season: { active: number; frost: ReturnType<typeof planningFrost> } | null = null;
  return filterSprayWindowsBySeason(
    events,
    (plantedAt) => {
      season ??= activePlanningYearAndFrost(new Date(now));
      return seasonOfPlanting(plantedAt, season.active, season.frost);
    },
    (year) => {
      if (byYear.has(year)) return byYear.get(year) ?? null;
      const setup = loadSeasonSetup(year);
      const filter = setup ? buildSeasonSprayFilter(setup, (pool ??= herbicides())) : null;
      byYear.set(year, filter);
      return filter;
    }
  );
}
