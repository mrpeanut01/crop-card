/**
 * UC-45 next-spring winterization reminder (informational — assists, never
 * gates; not a kernel rule).
 *
 * Raises a /today warning card when a sprayer has current-season activity
 * (a spray / decon / calibration touch this year) but was never winterized
 * after the *prior* season — i.e. `winterizedAt` is unset, or predates the
 * start of the current season. The intent: nudge the operator to recalibrate
 * (UC-10) and confirm the tank overwintered clean before the first spring
 * spray, without blocking anything.
 */

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

/** Epoch-ms of Jan 1 (local) for the year containing `nowMs`. */
export function startOfSeason(nowMs: number): number {
  const d = new Date(nowMs);
  return new Date(d.getFullYear(), 0, 1).getTime();
}

function lastActivity(s: SprayerWinterizeInput): number {
  return Math.max(s.lastSprayedAt ?? 0, s.lastDeconAt ?? 0, s.calibrationDate ?? 0);
}

/**
 * Derive per-sprayer winterization reminders. A sprayer flags when it has
 * activity in the current season but its `winterizedAt` is unset or older
 * than the season start (so it was not winterized after the prior season).
 */
export function deriveWinterizeAlerts(
  sprayers: SprayerWinterizeInput[],
  nowMs: number = Date.now()
): WinterizeAlert[] {
  const seasonStart = startOfSeason(nowMs);
  const alerts: WinterizeAlert[] = [];
  for (const s of sprayers) {
    const touchedThisSeason = lastActivity(s) >= seasonStart;
    if (!touchedThisSeason) continue;
    const winterizedThisSeasonOrLater = (s.winterizedAt ?? 0) >= seasonStart;
    // If the sprayer was winterized within this season it is fine — the
    // reminder is only for tanks that came out of storage un-winterized.
    if (winterizedThisSeasonOrLater) continue;
    alerts.push({
      sprayerId: s.id,
      label: s.label,
      neverWinterized: s.winterizedAt == null,
      uncalibrated: s.calibratedGpa == null
    });
  }
  return alerts;
}
