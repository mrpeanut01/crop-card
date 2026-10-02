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
import { t } from '$lib/i18n';
import { intlLocale } from '$lib/prefs';
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

/**
 * The day planning for season `year + 1` starts: eight weeks before season
 * `year`'s first fall frost, or July 1 of `year` with no saved dates. Season
 * `year` runs from `rolloverDateForSeason(year - 1)` up to this day.
 */
export function rolloverDateForSeason(year: number, frost: PlanningFrost | null | undefined): Date {
  const fall = firstFallFrost(new Date(year, PLANNING_ROLLOVER_MONTH, 1), frost);
  if (!fall) return new Date(year, PLANNING_ROLLOVER_MONTH, 1);
  return new Date(fall.getFullYear(), fall.getMonth(), fall.getDate() - ROLLOVER_LEAD_DAYS);
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

export function suggestionReason(
  now: Date,
  frost?: PlanningFrost | null,
  locale?: string | null
): string {
  const y = now.getFullYear();
  const next = y + 1;
  const fall = firstFallFrost(now, frost);
  const rolled = rollsOver(now, frost);
  if (fall) {
    const day = fall.toLocaleDateString(intlLocale(locale), { month: 'short', day: 'numeric' });
    const passed = now.getTime() >= fall.getTime();
    if (!rolled) return t(locale, 'wizard.year.frostOpen', { day });
    return passed
      ? t(locale, 'wizard.year.frostPassed', { day, next })
      : t(locale, 'wizard.year.frostClosing', { day, year: y, next });
  }
  return rolled
    ? t(locale, 'wizard.year.closed', { year: y, next })
    : t(locale, 'wizard.year.open');
}

export interface PlanningYearView {
  activeYear: number;
  suggestedYear: number;
  suggestionReason: string;
  options: number[];
  pastYears: number[];
  chosen: boolean;
}
