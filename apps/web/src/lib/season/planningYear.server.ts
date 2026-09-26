import { and, like } from 'drizzle-orm';

import { db } from '$lib/db/client';
import { appSettings } from '$lib/db/schema';
import { tenantWhere } from '$lib/db/tenant';
import { getSetting, setSetting } from '$lib/db/settings';
import { listYearsWithCrops } from '$lib/db/crops';
import { loadStoredFrost } from '$lib/climate/frostSettings.server';

import {
  isSelectablePlanningYear,
  pastPlanningYears,
  resolvePlanningYear,
  selectablePlanningYears,
  suggestPlanningYear,
  suggestionReason,
  type PlanningFrost,
  type PlanningYearView
} from './planningYear';

export const PLANNING_YEAR_KEY = 'season.planning_year';

function storedPlanningYear(): number | null {
  const raw = getSetting(PLANNING_YEAR_KEY);
  if (!raw || !/^\d{4}$/.test(raw)) return null;
  return Number(raw);
}

/** The frost dates saved for this farm (typed or from a station). */
export function planningFrost(): PlanningFrost {
  const { dates } = loadStoredFrost();
  return { lastSpring: dates.lastFrost, firstFall: dates.firstFrost };
}

export function getActivePlanningYear(now: Date = new Date()): number {
  return resolvePlanningYear(storedPlanningYear(), now, planningFrost());
}

export function setActivePlanningYear(year: number, now: Date = new Date()): void {
  if (!isSelectablePlanningYear(year, now)) {
    throw new Error(
      `planning year must be one of ${selectablePlanningYears(now).join(', ')}; got ${year}`
    );
  }
  setSetting(PLANNING_YEAR_KEY, String(year));
}

export function listSeasonSetupYears(): number[] {
  const rows = db
    .select({ key: appSettings.key })
    .from(appSettings)
    .where(and(tenantWhere(appSettings), like(appSettings.key, 'season_setup.%.philosophy')))
    .all();
  const years = new Set<number>();
  for (const r of rows) {
    const m = /^season_setup\.(\d{4})\.philosophy$/.exec(r.key);
    if (m) years.add(Number(m[1]));
  }
  return [...years];
}

export function loadPlanningYearView(now: Date = new Date()): PlanningYearView {
  const stored = storedPlanningYear();
  const frost = planningFrost();
  return {
    activeYear: resolvePlanningYear(stored, now, frost),
    suggestedYear: suggestPlanningYear(now, frost),
    suggestionReason: suggestionReason(now, frost),
    options: selectablePlanningYears(now),
    pastYears: pastPlanningYears([...listSeasonSetupYears(), ...listYearsWithCrops()], now),
    chosen: stored !== null && isSelectablePlanningYear(stored, now)
  };
}
