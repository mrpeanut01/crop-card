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
import { t } from '$lib/i18n';

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
  /** Open harvest tasks; one already due counts as today (#618). */
  harvestTasks?: ReadonlyArray<{ scheduledFor: number }>;
  now?: number;
}

/** Days until the next harvest: 0 while any harvest window is open or a
 *  harvest task is due (#618), else the days until the next one starts. */
export function deriveSeasonGlance(inputs: DeriveSeasonGlanceInputs): SeasonGlance {
  const now = inputs.now ?? Date.now();
  const starts: number[] = [];
  for (const e of inputs.derivedEvents) {
    if (e.kind !== 'harvest-window' || e.endMs < now) continue;
    starts.push(e.startMs);
  }
  for (const t of inputs.harvestTasks ?? []) starts.push(t.scheduledFor);
  const next = starts.length ? Math.min(...starts) : null;
  const daysToNextHarvest = next === null ? null : Math.max(0, Math.ceil((next - now) / DAY_MS));
  return {
    activePlantings: inputs.activePlantings,
    spraysYTD: inputs.spraysYTD,
    daysToNextHarvest
  };
}

/** #628: the three tiles as [number, label], with each label singular or
 *  plural for its own count. */
export function glanceCells(
  glance: SeasonGlance,
  locale?: string | null
): Array<{ id: string; value: string; label: string }> {
  const next = glance.daysToNextHarvest;
  return [
    {
      id: 'active',
      value: String(glance.activePlantings),
      label: t(locale, 'today.glance.active', { count: glance.activePlantings })
    },
    {
      id: 'sprays',
      value: String(glance.spraysYTD),
      label: t(locale, 'today.glance.sprays', { count: glance.spraysYTD })
    },
    {
      id: 'nextHarvest',
      value: next === null ? '—' : String(next),
      label: t(locale, 'today.glance.nextHarvest', next === null ? undefined : { count: next })
    }
  ];
}
