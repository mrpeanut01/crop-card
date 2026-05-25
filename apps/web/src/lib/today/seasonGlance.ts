/**
 * /today season-at-a-glance counts (Phase 25e · #97).
 *
 * Right-column card on the Almanac /today page renders 4 big numbers:
 * active plantings · sprays YTD · days to next harvest · plugins loaded.
 *
 * All four are cheap derived counts — no DB rounds beyond what the loader
 * already does. The helper just shapes them into the {n, label} pairs the
 * UI iterates.
 */

import type { CalendarEvent } from '$lib/calendar/engine';

export interface SeasonGlance {
  activePlantings: number;
  spraysYTD: number;
  daysToNextHarvest: number | null;
  pluginsLoaded: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfYear(now = Date.now()): number {
  const d = new Date(now);
  d.setMonth(0, 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export interface DeriveSeasonGlanceInputs {
  activePlantings: number;
  spraysYTD: number;
  pluginsLoaded: number;
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
    daysToNextHarvest,
    pluginsLoaded: inputs.pluginsLoaded
  };
}
