/**
 * Which planting year the operator is setting up. Client-safe; the
 * DB-backed read/write lives in `planningYear.server.ts`.
 *
 * In Loudoun County the main-season planting window closes by early July,
 * so from July 1 onward a new farm is really planning next year. The
 * operator may pick the current calendar year or one year ahead; earlier
 * years with data are view-only.
 */

export const PLANNING_ROLLOVER_MONTH = 6;

export function suggestPlanningYear(now: Date): number {
  const y = now.getFullYear();
  return now.getMonth() >= PLANNING_ROLLOVER_MONTH ? y + 1 : y;
}

export function selectablePlanningYears(now: Date): number[] {
  const y = now.getFullYear();
  return [y, y + 1];
}

export function isSelectablePlanningYear(year: number, now: Date): boolean {
  return selectablePlanningYears(now).includes(year);
}

export function resolvePlanningYear(stored: number | null, now: Date): number {
  if (stored !== null && isSelectablePlanningYear(stored, now)) return stored;
  return suggestPlanningYear(now);
}

/** Years before the current calendar year that have any saved data,
 *  newest first. These are the view-only seasons. */
export function pastPlanningYears(yearsWithData: Iterable<number>, now: Date): number[] {
  const y = now.getFullYear();
  return [...new Set(yearsWithData)].filter((yr) => yr < y).sort((a, b) => b - a);
}

export function suggestionReason(now: Date): string {
  return now.getMonth() >= PLANNING_ROLLOVER_MONTH
    ? `The ${now.getFullYear()} planting window has mostly closed, so most farms are planning ${now.getFullYear() + 1} now.`
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
