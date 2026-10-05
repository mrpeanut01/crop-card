/**
 * /today season-at-a-glance counts (Phase 25e · #97).
 *
 * Right-column card on the Almanac /today page renders 3 big numbers:
 * active plantings · sprays YTD · days to next harvest.
 *
 * All three are cheap derived counts — no DB rounds beyond what the loader
 * already does. The helper just shapes them into the {n, label} pairs the
 * UI iterates.
 */

import type { CalendarEvent } from '$lib/calendar/engine';
import { zonedYearStartMs } from '$lib/exports/dateRange';

export interface SeasonGlance {
  activePlantings: number;
  spraysYTD: number;
  daysToNextHarvest: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Jan 1 00:00 on the farm's calendar (pass `farmTimeZone()`). */
export function startOfYear(now: number, timeZone: string): number {
  return zonedYearStartMs(now, timeZone);
}

export interface DeriveSeasonGlanceInputs {
  activePlantings: number;
  spraysYTD: number;
  derivedEvents: CalendarEvent[];
  now?: number;
}

export function deriveSeasonGlance(inputs: DeriveSeasonGlanceInputs): SeasonGlance {
  const now = inputs.now ?? Date.now();
  const nextHarvest = inputs.derivedEvents
    .filter((e) => e.kind === 'harvest-window' && e.startMs >= now)
    .sort((a, b) => a.startMs - b.startMs)[0];
  const daysToNextHarvest = nextHarvest
    ? Math.max(0, Math.ceil((nextHarvest.startMs - now) / DAY_MS))
    : null;
  return {
    activePlantings: inputs.activePlantings,
    spraysYTD: inputs.spraysYTD,
    daysToNextHarvest
  };
}
