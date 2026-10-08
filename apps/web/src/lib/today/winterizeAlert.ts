/**
 * UC-45 next-spring winterization reminder (informational — assists, never
 * gates; not a kernel rule).
 *
 * Raises a spring /today card when a sprayer came out of storage (activity
 * this year) without being winterized after its last use of the prior
 * season. The intent: nudge the operator to check the tank overwintered
 * clean and recalibrate (UC-10) before spraying, without blocking anything.
 * Recalibrating this season clears it, and it is gone by July.
 */

import { zonedDayStartMs, zonedYearStartMs } from '$lib/exports/dateRange';
import { DEFAULT_PREFS } from '$lib/prefs';

export interface SprayerWinterizeInput {
  id: string;
  label: string;
  calibratedGpa: number | null;
  calibrationDate?: number;
  lastSprayedAt?: number;
  lastDeconAt?: number;
  winterizedAt?: number;
}

export interface WinterizeAlert {
  sprayerId: string;
  label: string;
  /** True when the sprayer has never been winterized at all. */
  neverWinterized: boolean;
  /** True when calibration is missing (recalibrate before spring spray). */
  uncalibrated: boolean;
}

/** Epoch-ms of Jan 1 on the farm's calendar (pass `farmTimeZone()`) for
 *  the year containing `nowMs`. */
export function startOfSeason(nowMs: number, timeZone: string): number {
  return zonedYearStartMs(nowMs, timeZone);
}

function lastActivity(s: SprayerWinterizeInput): number {
  return Math.max(s.lastSprayedAt ?? 0, s.lastDeconAt ?? 0, s.calibrationDate ?? 0);
}

const DAY_MS = 86_400_000;

/** Epoch-ms of Jul 1 on the farm's calendar in the season `seasonStart`
 *  opens: the spring reminder is gone by then. */
export function endOfSpringWindow(seasonStart: number, timeZone: string): number {
  const year = new Date(seasonStart + DAY_MS).getUTCFullYear();
  return zonedDayStartMs(year, 7, 1, timeZone);
}

/**
 * Derive per-sprayer spring winterization reminders (#651). A sprayer flags
 * when, in the spring window (Jan 1 to Jun 30 on the farm calendar):
 *   - it was used before this season and has activity this season,
 *   - it has not been recalibrated this season, and
 *   - it was not winterized after its last use of the prior season.
 * `usedBeforeSeason` maps each sprayer used before this season to its
 * latest log time before the season (`equipmentLastActiveBefore`); a plain
 * set only says which ones were used, so then a winterization counts only
 * when it is from this season.
 */
export function deriveWinterizeAlerts(
  sprayers: SprayerWinterizeInput[],
  nowMs: number = Date.now(),
  usedBeforeSeason?: ReadonlySet<string> | ReadonlyMap<string, number>,
  /** The farm's zone (`farmTimeZone()`), so the season starts on its Jan 1. */
  timeZone: string = DEFAULT_PREFS.timeZone
): WinterizeAlert[] {
  const seasonStart = startOfSeason(nowMs, timeZone);
  if (nowMs >= endOfSpringWindow(seasonStart, timeZone)) return [];
  const alerts: WinterizeAlert[] = [];
  for (const s of sprayers) {
    const touchedThisSeason = lastActivity(s) >= seasonStart;
    if (!touchedThisSeason) continue;
    if (usedBeforeSeason && !usedBeforeSeason.has(s.id)) continue;
    if ((s.calibrationDate ?? 0) >= seasonStart) continue;
    const priorLastUse = usedBeforeSeason instanceof Map ? usedBeforeSeason.get(s.id) : undefined;
    const w = s.winterizedAt;
    const winterizedAfterPriorUse =
      w != null && (w >= seasonStart || (priorLastUse !== undefined && w >= priorLastUse));
    if (winterizedAfterPriorUse) continue;
    alerts.push({
      sprayerId: s.id,
      label: s.label,
      neverWinterized: w == null,
      uncalibrated: s.calibratedGpa == null
    });
  }
  return alerts;
}
