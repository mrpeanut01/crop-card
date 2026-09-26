/**
 * Which planting year the operator is setting up. Client-safe; the
 * DB-backed read/write lives in `planningYear.server.ts`.
 *
 * A farm with saved frost dates rolls over to next year once today is
 * within eight weeks of this season's first fall frost, so a Gulf coast
 * garden still plans its fall beds in September. Without saved dates the
 * suggestion rolls over on July 1. The operator may pick the current
 * calendar year or one year ahead; earlier years with data are view-only.
 */

import { parseMmDd } from '$lib/schedule/constants';
import { frostSeasonYears } from '$lib/schedule/frostSeason';

export const PLANNING_ROLLOVER_MONTH = 6;
export const ROLLOVER_LEAD_DAYS = 56;

/** The farm's saved frost dates as `MM-DD`, or null when none is saved. */
export interface PlanningFrost {
  lastSpring: string | null;
  firstFall: string | null;
}

/** Local midnight of this calendar year's season's first fall frost. */
function firstFallFrost(now: Date, frost: PlanningFrost | null | undefined): Date | null {
  const fall = parseMmDd(frost?.firstFall ?? undefined);
  if (!fall) return null;
  const y = now.getFullYear();
  const spring = parseMmDd(frost?.lastSpring ?? undefined);
  const year = spring
    ? frostSeasonYears(y, spring, fall).firstFallYear
    : fall.month < PLANNING_ROLLOVER_MONTH
      ? y + 1
      : y;
  return new Date(year, fall.month, fall.day);
}

function rollsOver(now: Date, frost: PlanningFrost | null | undefined): boolean {
  const fall = firstFallFrost(now, frost);
  if (!fall) return now.getMonth() >= PLANNING_ROLLOVER_MONTH;
  const rollover = new Date(
    fall.getFullYear(),
    fall.getMonth(),
    fall.getDate() - ROLLOVER_LEAD_DAYS
  );
  return now.getTime() >= rollover.getTime();
}

export function suggestPlanningYear(now: Date, frost?: PlanningFrost | null): number {
  const y = now.getFullYear();
  return rollsOver(now, frost) ? y + 1 : y;
}

export function selectablePlanningYears(now: Date): number[] {
  const y = now.getFullYear();
  return [y, y + 1];
}

export function isSelectablePlanningYear(year: number, now: Date): boolean {
  return selectablePlanningYears(now).includes(year);
}

export function resolvePlanningYear(
  stored: number | null,
  now: Date,
  frost?: PlanningFrost | null
): number {
  if (stored !== null && isSelectablePlanningYear(stored, now)) return stored;
  return suggestPlanningYear(now, frost);
}

/** Years before the current calendar year that have any saved data,
 *  newest first. These are the view-only seasons. */
export function pastPlanningYears(yearsWithData: Iterable<number>, now: Date): number[] {
  const y = now.getFullYear();
  return [...new Set(yearsWithData)].filter((yr) => yr < y).sort((a, b) => b - a);
}

export function suggestionReason(now: Date, frost?: PlanningFrost | null): string {
  const y = now.getFullYear();
  const fall = firstFallFrost(now, frost);
  const rolled = rollsOver(now, frost);
  if (fall) {
    const day = fall.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const passed = now.getTime() >= fall.getTime();
    if (!rolled)
      return `Your first fall frost is around ${day}, so there is still time to plant this season.`;
    return passed
      ? `Your first fall frost, around ${day}, has passed, so most farms are planning ${y + 1} now.`
      : `Your first fall frost is around ${day}, so the ${y} planting window has mostly closed. Most farms are planning ${y + 1} now.`;
  }
  return rolled
    ? `The ${y} planting window has mostly closed, so most farms are planning ${y + 1} now.`
    : `There is still time to plant this spring and summer.`;
}

export interface PlanningYearView {
  activeYear: number;
  suggestedYear: number;
  suggestionReason: string;
  options: number[];
  pastYears: number[];
  chosen: boolean;
}
